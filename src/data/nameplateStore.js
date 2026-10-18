// Where nameplates come from.
//
// The tournament tool knows a player's name and code and nothing else — no avatar, no flag, no
// medal history. It asks here for the rest. That split is the point: a tournament is one
// afternoon, a nameplate is everything before it, and the two have no business living in the
// same record.
//
// Backed by the server, but never read from it while a round is being played. What the pairing
// screen renders is a snapshot stored on the tournament itself, taken once when the players
// were entered. Two reasons, and the second is the real one:
//
//   - An event happens in a room whose wifi cannot be relied on, and the pairing sheet is the
//     one thing that must not stop working there.
//   - A nameplate is a statement about a moment. Meetup#1's sheet should show the flag Ray was
//     wearing that afternoon, not the one he earned two events later — otherwise every old
//     pairing sheet silently rewrites itself.
import { resolveTitle } from './assetCatalogue'
import { fallbackNameplate, keyFor, NAMEPLATE_VERSION } from '../game/playerNameplate'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787'

// The server's row shape -> the shape PlayerBanner renders. Kept here rather than in the
// component so the column names stop at this file.
function fromRow(row) {
  return {
    version: NAMEPLATE_VERSION,
    playerKey: `code:${row.code}`,
    name: row.name || '',
    code: row.code,
    avatar: row.avatar,
    background: row.background,
    title: resolveTitle(row.title_id),
    medals: { gold: row.gold || 0, silver: row.silver || 0, bronze: row.bronze || 0 },
    events: row.events || 0,
    // Stored 0–1, shown as a percentage.
    winRate: row.tour_win_rate === null || row.tour_win_rate === undefined
      ? null
      : Math.round(row.tour_win_rate * 100)
  }
}

/**
 * Snapshots for a list of tournament players, keyed by roster code.
 *
 * Resolves to an empty object rather than rejecting when the server can't be reached: a venue
 * with no signal should cost the organiser some artwork, not the ability to run the event.
 */
export async function fetchNameplates(players = []) {
  const codes = [...new Set(
    players.map(p => String(p?.code || '').trim().toUpperCase()).filter(Boolean)
  )]
  if (!codes.length) return {}
  try {
    const res = await fetch(`${API_BASE}/api/players/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes })
    })
    if (!res.ok) return {}
    const data = await res.json()
    const out = {}
    Object.values(data.players || {}).forEach(row => { out[row.code] = fromRow(row) })
    return out
  } catch (e) {
    return {}
  }
}

/**
 * One code, answered honestly.
 *
 * Unlike fetchNameplates above, this one throws when the server could not be reached, and
 * resolves to null only when the server answered and had no such player. The difference matters
 * wherever a screen is about to tell somebody their code is wrong: "there is no P000123" and
 * "the wifi dropped" are not the same sentence, and the first one is worth refusing a code over.
 */
export async function lookupPlayerByCode(code) {
  const wanted = String(code || '').trim().toUpperCase()
  if (!wanted) return null
  const res = await fetch(`${API_BASE}/api/players/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes: [wanted] })
  })
  if (!res.ok) throw new Error(`lookup failed (${res.status})`)
  const data = await res.json()
  const row = (data.players || {})[wanted]
  return row ? fromRow(row) : null
}

/**
 * Re-take every snapshot, overwriting what is already there. Returns how many changed.
 *
 * The opposite of ensureNameplates below, and deliberately a separate function with a louder
 * name — "silently rewriting history" is the thing that one exists to prevent, and this is the
 * button that does it on purpose.
 *
 * It is for before the event, not after. A player who changed their flag this morning should
 * appear in today's pairings wearing it; last month's pairing sheet should not quietly change
 * because of it. Nothing stops an organiser pressing this on a finished tournament, so the
 * screen asks first.
 *
 * Players with no code are left alone: there is nothing on file to re-take.
 */
export async function refreshNameplates(players = []) {
  const coded = players.filter(p => String(p?.code || '').trim())
  if (!coded.length) return 0
  const found = await fetchNameplates(coded)
  let changed = 0
  coded.forEach(p => {
    const plate = found[String(p.code).trim().toUpperCase()]
    if (!plate) return
    // Compared before assigning, so the count means "actually different" rather than
    // "we asked" — the screen reports it to a person who wants to know if anything moved.
    const before = JSON.stringify(p.nameplate || null)
    if (before === JSON.stringify(plate) && p.name === plate.name) return
    p.nameplate = plate
    if (plate.name) p.name = plate.name
    changed++
  })
  return changed
}

/**
 * Attach snapshots to a tournament's players, in place. Returns true if anything changed, so the
 * caller knows whether the tournament is worth saving again.
 *
 * Only fills gaps. A player who already carries a snapshot keeps it — re-fetching would be the
 * silent rewriting of history this module exists to prevent.
 *
 * A code that resolves also replaces the name on the roster. The organiser typed what they heard
 * across a sign-in desk — "阿固" for someone the record calls "Miso" — and the two then disagree
 * on every pairing sheet and in every upload. A code is the one thing in that exchange that is
 * unambiguous, so when there is one, it wins. Renaming afterwards still works: the roster's name
 * beats the snapshot's from then on (see withEventName).
 */
export async function ensureNameplates(players = []) {
  const missing = players.filter(p => !p.nameplate && String(p?.code || '').trim())
  if (!missing.length) return false
  const found = await fetchNameplates(missing)
  let changed = false
  missing.forEach(p => {
    const plate = found[String(p.code).trim().toUpperCase()]
    if (!plate) return
    p.nameplate = plate
    if (plate.name && plate.name !== p.name) p.name = plate.name
    changed = true
  })
  return changed
}

// The name shown is the one on the roster, not the one in the snapshot.
//
// Usually they are the same: a code that resolved copied its name onto the roster when the
// player was entered. They part ways when the organiser renames someone afterwards — to tell two
// 小明 apart, say — and that edit should reach the plate immediately, which it would not if the
// snapshot won.
//
// Everything else — the flag, the face, the title, the record — stays the snapshot's to say.
function withEventName(plate, player) {
  const name = String(player.name || '').trim()
  return name && name !== plate.name ? { ...plate, name } : plate
}

/**
 * The nameplate for one tournament player.
 *
 * Synchronous, because this is called once per row while the pairing table renders. A player
 * with no snapshot — new, no code, or entered while the server was unreachable — gets one built
 * from what the tournament does know. A row without a nameplate would read as a rendering bug
 * rather than as "nothing recorded yet".
 */
export function lookupNameplate(player) {
  if (!player) return null
  return withEventName(player.nameplate || fallbackNameplate(player), player)
}

export function lookupNameplates(players = []) {
  return players.map(p => lookupNameplate(p))
}

export { keyFor }
