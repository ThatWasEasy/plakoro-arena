// One finished tournament, as one file.
//
// Tournaments live in localStorage, which is per-browser and per-device — a run on a phone at a
// venue is invisible to the laptop at home. This is how one travels: a single JSON file that can
// be imported back and carried on with, or kept as the record of what happened.
//
// Written to be legible. The internal representation references players by uuid, which is right
// for the running app and useless in a file someone opens to check a result — "player1Id":
// "a3f2-…" tells a reader nothing. Here a match names the people in it. The cost is that names
// have to be unique within a tournament to be unambiguous, which `ref` below handles.
//
// Round-tripping has to be lossless: re-pairing a round from a half-restored tournament would
// produce different pairings than the ones people actually played, and the standings with them.
import { computeStandings, isRoundComplete, isTournamentComplete } from '../game/tournamentPairing'

export const TRANSFER_FORMAT = 'plakoro-tournament'
export const TRANSFER_VERSION = 2

const SYSTEMS = ['swiss', 'elimination']

function pad(n) {
  return String(n).padStart(2, '0')
}

export function isoDate(value) {
  const d = new Date(value || Date.now())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The label a match uses to point at a player. Their name, except when two people in the same
// tournament registered under the same one — then the later entries get a suffix, so every
// reference still resolves to exactly one person. Rare, but silently merging two players'
// results is not a failure mode worth leaving open.
function assignRefs(players) {
  const used = new Map()
  return players.map(p => {
    const name = String(p.name || '').trim()
    const seen = used.get(name) || 0
    used.set(name, seen + 1)
    return { player: p, ref: seen === 0 ? name : `${name}#${seen + 1}` }
  })
}

export function serialize(tournament) {
  const refs = assignRefs(tournament.players || [])
  const refById = new Map(refs.map(({ player, ref }) => [player.id, ref]))

  return JSON.stringify({
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),

    name: tournament.name || '',
    date: isoDate(tournament.createdAt),
    // Carried through rather than dropped. The tool never asks for a venue — it isn't needed to
    // run an event — but a file is also the record of one, and where it happened is the kind of
    // thing nobody can reconstruct a year later.
    ...(tournament.venue ? { venue: tournament.venue } : {}),
    system: tournament.system || tournament.format || 'swiss',
    // How many rounds the Swiss event is scheduled for. Not derivable from the rounds already
    // played — three rounds played is a finished three-round event or the middle of a five —
    // and "is this finished" turns on it: standings, the champion, and whether another round
    // can be generated. Elimination ends when one match remains, so it needs no target.
    ...(tournament.swissTotalRounds ? { totalRounds: tournament.swissTotalRounds } : {}),

    // Optional fields are omitted rather than written as null, so a plain tournament of players
    // who all played to the end reads as exactly that.
    players: refs.map(({ player, ref }) => {
      const out = { name: String(player.name || '').trim() }
      if (ref !== out.name) out.ref = ref
      if (player.code) out.code = player.code
      if (player.dropped) out.dropped = true
      return out
    }),

    rounds: (tournament.rounds || []).map(round => ({
      round: round.roundNumber,
      matches: round.matches.map(m => {
        const out = {}
        if (m.table) out.table = m.table
        out.a = refById.get(m.player1Id) || ''
        if (m.player2Id === null) {
          out.bye = true
        } else {
          out.b = refById.get(m.player2Id) || ''
          // Pairing records whether it had to repeat a pairing it would rather have avoided.
          // Recomputing it later from history would not necessarily agree with the judgement
          // made at the time, so it is carried rather than derived.
          if (m.rematch) out.rematch = true
        }
        if (m.result === 'draw') out.draw = true
        else if (m.result === 'p1') out.winner = out.a
        else if (m.result === 'p2') out.winner = out.b
        return out
      })
    }))
  }, null, 2)
}

// Every failure returns a reason rather than throwing: all of them are things the person
// importing can act on — wrong file, truncated copy, a file from some other app.
export function parse(text) {
  let data
  try {
    data = JSON.parse(String(text || ''))
  } catch (e) {
    return { ok: false, reason: 'notJson' }
  }
  return fromObject(data)
}

// `id` lets a caller override the fresh uuid below — used when pulling a tournament back from
// the database (TournamentDownloadModal.vue), where the whole point is a *live* handle on that
// same row: re-uploading it later has to update it, not fork a duplicate the way importing the
// same file twice intentionally does.
export function fromObject(data, { id } = {}) {
  if (!data || data.format !== TRANSFER_FORMAT) return { ok: false, reason: 'wrongFormat' }
  // Refusing a newer file is kinder than importing it partially: a future version could add a
  // field this build drops, and the loss would only surface much later.
  if (Number(data.version) > TRANSFER_VERSION) return { ok: false, reason: 'tooNew' }
  if (!Array.isArray(data.players) || !Array.isArray(data.rounds)) {
    return { ok: false, reason: 'malformed' }
  }

  const byRef = new Map()
  const players = data.players.map(p => {
    const name = String(p.name || '').trim()
    const player = { id: crypto.randomUUID(), name }
    if (p.code) player.code = String(p.code).trim().toUpperCase()
    if (p.dropped) player.dropped = true
    byRef.set(String(p.ref || name), player)
    return player
  })
  if (players.some(p => !p.name)) return { ok: false, reason: 'malformed' }

  const unknown = new Set()
  const rounds = data.rounds.map((round, i) => ({
    roundNumber: Number(round.round) || i + 1,
    matches: (round.matches || []).map(m => {
      const a = byRef.get(String(m.a ?? ''))
      const b = m.bye ? null : byRef.get(String(m.b ?? ''))
      if (!a) unknown.add(String(m.a ?? ''))
      if (!m.bye && !b) unknown.add(String(m.b ?? ''))

      // A bye counts as a win in the standings but has no recorded result, which is how the
      // running tournament represents it too.
      let result = null
      if (m.draw) result = 'draw'
      else if (m.winner) result = String(m.winner) === String(m.a) ? 'p1' : 'p2'

      return {
        id: crypto.randomUUID(),
        player1Id: a ? a.id : null,
        player2Id: b ? b.id : null,
        result: m.bye ? null : result,
        rematch: !!m.rematch,
        ...(m.table ? { table: Number(m.table) } : {})
      }
    })
  }))

  // A match naming someone absent from the player list cannot be placed, and importing it
  // anyway would silently drop results from the standings.
  if (unknown.size) return { ok: false, reason: 'unknownPlayer', names: [...unknown] }

  const system = SYSTEMS.includes(data.system) ? data.system : 'swiss'
  // Files written before this field existed fall back to the rounds they contain. For the
  // finished events those files record that is the right answer; a mid-event export from that
  // era would read as complete, which is the lesser of the two errors — the alternative leaves
  // the tournament permanently unfinishable.
  const totalRounds = Number(data.totalRounds) || rounds.length || 1
  return {
    ok: true,
    exportedAt: data.exportedAt,
    tournament: {
      // A fresh id by default, so importing the same file twice makes two tournaments rather
      // than one overwriting the other — right for a file, which is a record of an event, not
      // a live handle on one. `id` above overrides this for the one caller that wants the
      // opposite.
      id: id || crypto.randomUUID(),
      name: String(data.name || '').trim() || '(未命名)',
      createdAt: data.date ? new Date(`${data.date}T00:00:00`).toISOString() : new Date().toISOString(),
      ...(data.venue ? { venue: String(data.venue).trim() } : {}),
      format: system,
      ...(system === 'swiss' ? { swissTotalRounds: totalRounds } : {}),
      players,
      rounds
    }
  }
}

// A filename someone can recognise in a downloads folder a week later.
export function fileName(tournament) {
  const date = isoDate(tournament.createdAt).replace(/-/g, '')
  const safe = String(tournament.name || 'tournament')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 40) || 'tournament'
  return `${date}-${safe}.json`
}

// Kept here rather than in a component so the download behaves the same wherever it's offered.
export function downloadText(text, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick: doing it synchronously can cancel the download in some browsers
  // before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// --- server upload ---
//
// A second serialization, alongside the file-export one above — different audience, different
// shape. The file export names players by text (`ref`) because a human opens it; the server
// already has a real `players` table keyed by code, so this one carries the editor's internal
// uuids instead and lets the server resolve/create codes itself. See POST /api/admin/tournaments
// in server/index.mjs for the other half of this contract.

// Same rule playerBadges.js's isFullyPlayed uses: the round count alone isn't enough, since a
// Swiss event sitting on its final round with results unentered already satisfies that — every
// match in every round has to actually have a result before a standing counts as final.
export function isFullyPlayed(tournament) {
  return isTournamentComplete(tournament) && (tournament.rounds || []).every(isRoundComplete)
}

export function buildUploadPayload(tournament, rewardPackageId) {
  const finished = isFullyPlayed(tournament)
  const placeOf = new Map()
  if (finished) {
    computeStandings(tournament).forEach((s, i) => placeOf.set(s.playerId, i + 1))
  }
  return {
    id: tournament.id,
    name: tournament.name || '',
    date: isoDate(tournament.createdAt),
    venue: tournament.venue || null,
    format: tournament.format === 'elimination' ? 'elimination' : 'swiss',
    totalRounds: tournament.format === 'swiss' ? tournament.swissTotalRounds : (tournament.rounds || []).length,
    // Optional — see src/components/admin/AdminRewardsApp.vue and
    // POST /api/admin/reward-packages. No package just means nothing gets granted.
    rewardPackageId: rewardPackageId || null,
    players: (tournament.players || []).map(p => ({
      id: p.id,
      code: p.code || null,
      name: p.name,
      place: placeOf.get(p.id) ?? null
    })),
    matches: (tournament.rounds || []).flatMap(r => r.matches.map(m => ({
      round: r.roundNumber,
      p1Id: m.player1Id,
      p2Id: m.player2Id,
      result: m.result
    })))
  }
}
