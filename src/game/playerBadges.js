// A player's record across every tournament on this device.
//
// One event answers "who won today". A banner answers "who is this person" — how many events
// they have turned up to, how they have placed, what they have earned the right to be called.
// That only exists in the aggregate, so this reads every stored tournament rather than the one
// on screen.
//
// Medals are placements: gold for winning an event, silver for second, bronze for third. The
// familiar competition tally, which is the point — nobody at a venue needs it explained.
import { computeStandings, isTournamentComplete, isRoundComplete } from './tournamentPairing'

export const GOLD = 'gold'
export const SILVER = 'silver'
export const BRONZE = 'bronze'

// Identity across events is the whole problem a banner has to solve, and this data alone has no
// perfect answer.
//
// A code is the organiser's own statement that two entries are the same person, so it wins.
// Without one there is only the name, and matching on it is a judgement: within a small
// community the same name at two events is almost always the same player, and treating them as
// strangers would empty out every banner. Two different people sharing a name do get merged —
// the fix is giving one of them a code, which is what the registration field is for.
export function identityOf(player) {
  const code = String(player.code || '').trim().toUpperCase()
  if (code) return `code:${code}`
  return `name:${String(player.name || '').trim().toLowerCase().replace(/\s+/g, '')}`
}

// A stricter bar than the tool's own "is it over". isTournamentComplete asks whether the
// scheduled rounds have been paired — the right question for enabling "generate next round",
// and the wrong one for handing out a medal: a Swiss event sitting on its final round with no
// results entered passes it, and the standings at that moment are a round out of date.
//
// Deliberately local rather than a change to isTournamentComplete, whose callers want the
// looser meaning.
export function isFullyPlayed(tournament) {
  return isTournamentComplete(tournament) && (tournament.rounds || []).every(isRoundComplete)
}

function emptyRecord(player) {
  return {
    key: identityOf(player),
    name: String(player.name || '').trim(),
    code: String(player.code || '').trim().toUpperCase() || null,
    events: 0,
    ranked: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    byes: 0,
    [GOLD]: 0,
    [SILVER]: 0,
    [BRONZE]: 0,
    best: null
  }
}

/**
 * Build a record per player across the given tournaments.
 *
 * Returns a Map of identity -> record, keyed rather than listed because the pairing table looks
 * players up one row at a time.
 */
export function aggregatePlayers(tournaments = []) {
  const out = new Map()

  tournaments.forEach(tournament => {
    if (!tournament || !Array.isArray(tournament.players)) return

    // Placement only means something once the event is over. A tournament in round one has
    // standings — someone is top of them — but calling that player the champion hands out a
    // gold medal the afternoon can take back.
    const finished = isFullyPlayed(tournament)
    const standings = finished ? computeStandings(tournament) : []
    const placeOf = new Map(standings.map((s, i) => [s.playerId, i + 1]))
    const byId = new Map(tournament.players.map(p => [p.id, p]))

    tournament.players.forEach(player => {
      const key = identityOf(player)
      if (!key || key === 'name:') return
      if (!out.has(key)) out.set(key, emptyRecord(player))
      const rec = out.get(key)

      // The latest name wins, so someone who changed what they register under shows the name
      // the organiser last saw rather than the oldest on file.
      if (player.name) rec.name = String(player.name).trim()
      if (player.code && !rec.code) rec.code = String(player.code).trim().toUpperCase()

      rec.events++
      const place = placeOf.get(player.id) || null
      if (place) {
        rec.ranked++
        if (place === 1) rec[GOLD]++
        else if (place === 2) rec[SILVER]++
        else if (place === 3) rec[BRONZE]++
        if (rec.best === null || place < rec.best) rec.best = place
      }
    })

    // Counted from the matches rather than the standings, so an event still in progress
    // contributes everything that has actually been played.
    tournament.rounds?.forEach(round => {
      round.matches?.forEach(m => {
        const p1 = byId.get(m.player1Id)
        if (!p1) return
        if (m.player2Id === null) {
          const rec = out.get(identityOf(p1))
          if (rec) rec.byes++
          return
        }
        if (!m.result) return
        const p2 = byId.get(m.player2Id)
        if (!p2) return
        const r1 = out.get(identityOf(p1))
        const r2 = out.get(identityOf(p2))
        if (!r1 || !r2) return

        if (m.result === 'draw') { r1.draws++; r2.draws++ }
        else if (m.result === 'p1') { r1.wins++; r2.losses++ }
        else if (m.result === 'p2') { r2.wins++; r1.losses++ }
      })
    })
  })

  return out
}

// Decided matches only. A bye is a win in the standings but says nothing about the player, and
// counting it would quietly inflate everyone who ever sat out an odd round.
export function winRate(rec) {
  const played = rec.wins + rec.losses + rec.draws
  if (!played) return null
  return rec.wins / played
}

// Gold first, never summed. Two silvers are not one gold, and a single number says they are.
export function medalTally(rec) {
  return [
    { tier: GOLD, n: rec[GOLD] },
    { tier: SILVER, n: rec[SILVER] },
    { tier: BRONZE, n: rec[BRONZE] }
  ].filter(m => m.n > 0)
}

// The line under the name. Earned from the record rather than typed, so it cannot be claimed —
// which is the only thing that makes a title worth having.
//
// Checked hardest-first and only one is shown: a banner carrying four titles says nothing. When
// players can set their own, this becomes the default they start from and the pool they are
// allowed to choose between.
//
// `rank` is what the title is worth, and the banner colours it accordingly. Without it every
// title looked identical, so "新人" arrived in the same gold as "不敗" — which drains the
// gold of any meaning, since the whole point of a rare colour is that most people don't have
// it. Two titles can share a rank; what must not happen is everything sharing one.
export const TITLE_RANKS = ['legend', 'gold', 'epic', 'silver', 'bronze', 'plain']

const TITLES = [
  { key: 'champion',   rank: 'gold',   test: r => r[GOLD] >= 1 },
  // Not a placement, so not a metal — a distinct colour of its own.
  { key: 'undefeated', rank: 'epic',   test: r => r.events >= 1 && r.losses === 0 && r.wins >= 3 },
  { key: 'podium',     rank: 'silver', test: r => r[SILVER] + r[BRONZE] >= 1 },
  { key: 'regular',    rank: 'plain',  test: r => r.events >= 3 },
  { key: 'rookie',     rank: 'plain',  test: r => r.events === 1 }
]

export function titleOf(rec) {
  const hit = TITLES.find(t => t.test(rec))
  return hit ? { key: hit.key, rank: hit.rank } : null
}

// Leaderboard order: golds, then silvers, then bronzes, then win rate, then events. The same
// precedence a medal table uses; win rate sits below because attending more events means more
// chances to place, and the tally already carries that.
export function rankPlayers(records) {
  return [...records.values()].sort((a, b) =>
    b[GOLD] - a[GOLD] ||
    b[SILVER] - a[SILVER] ||
    b[BRONZE] - a[BRONZE] ||
    (winRate(b) ?? -1) - (winRate(a) ?? -1) ||
    b.events - a.events ||
    a.name.localeCompare(b.name))
}
