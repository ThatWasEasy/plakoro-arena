// What a player's nameplate looks like, as data.
//
// The banner component renders one of these and derives nothing itself. Keeping the shape
// separate from the rendering is what makes the next step possible: when players can edit
// their own, the thing that gets stored, validated and sent somewhere is exactly this object —
// not a tangle of props spread across a template.
//
// Assets are referenced by id, never by URL. A bundled URL has a content hash in it and
// changes on every rebuild, so storing one would mean every saved nameplate pointing at a file
// that no longer exists. The component resolves ids to images.
import { titleOf, winRate, TITLE_RANKS } from './playerBadges'
import {
  BACKGROUND_IDS, AVATAR_IDS, FALLBACK_BACKGROUND, FALLBACK_AVATAR, CURRENT_SEASON
} from '../data/nameplateAssets'

export const NAMEPLATE_VERSION = 1

// Artwork ids, read off the folders — see data/nameplateAssets.js. Flags and avatars are
// separate lists because they are separate choices: a player on the October champion flag may
// want a mascot face rather than the matching crest.
export const BACKGROUNDS = BACKGROUND_IDS
export const AVATARS = AVATAR_IDS

// The only two fields a player may set. Everything else on the nameplate is earned, and a
// stored override for it would be a claim rather than a record — which is the whole reason
// medals are worth showing.
export const EDITABLE_FIELDS = ['avatar', 'background']

// Which tier a record earns. Artwork comes in seasonal sets — `2026-10-champion` and so on —
// so the tier alone is not an id; `season` says which set to take it from. `CURRENT_SEASON`
// itself lives in data/nameplateAssets.js, next to the fallback ids that have to track it.
export function tierOf(record) {
  if (record.best === 1) return 'champion'
  if (record.best === 2 || record.best === 3) return 'winner'
  if (record.events > 0) return 'participants'
  return 'default'
}

// Lets a tier be compared rather than just named — "has this player reached at least winner?" —
// which is what gates the profile screen's artwork pickers against `tierOfAsset()`.
export const TIER_RANK = { default: 0, participants: 1, winner: 2, champion: 3 }

export function defaultAsset(record, season = CURRENT_SEASON) {
  return `${season}-${tierOf(record)}`
}

/**
 * Derive a nameplate from a player's aggregated record.
 *
 * `overrides` is whatever the player has saved — applied last, and only over the editable
 * fields. Passing a forged `medals` through it changes nothing.
 */
export function buildNameplate(record, overrides = null) {
  const plate = {
    version: NAMEPLATE_VERSION,
    playerKey: record.key,
    name: record.name,
    code: record.code || null,
    avatar: defaultAsset(record),
    background: defaultAsset(record),
    title: titleOf(record),
    medals: { gold: record.gold, silver: record.silver, bronze: record.bronze },
    events: record.events,
    // Whole numbers: a nameplate is read at a glance across a table, and 66.7% says nothing
    // 67% doesn't. Null when nobody has played a decided match yet — showing 0% then would
    // read as "lost everything" rather than "no record".
    winRate: winRate(record) === null ? null : Math.round(winRate(record) * 100)
  }
  return overrides ? applyOverrides(plate, overrides) : plate
}

// Unknown ids are ignored rather than trusted: a saved nameplate can outlive the artwork it
// names, and a flag that silently falls back to the earned one is better than a broken image.
export function applyOverrides(plate, overrides) {
  const out = { ...plate }
  if (!overrides || typeof overrides !== 'object') return out
  if (AVATARS.includes(overrides.avatar)) out.avatar = overrides.avatar
  if (BACKGROUNDS.includes(overrides.background)) out.background = overrides.background
  return out
}

// What gets stored for a player — just their choices, not the whole plate. Storing the derived
// fields too would mean a saved medal count going stale the moment they play another event.
export function toOverrides(plate) {
  const out = {}
  EDITABLE_FIELDS.forEach(f => { if (plate[f]) out[f] = plate[f] })
  return out
}

export function serializeOverrides(byPlayerKey) {
  return JSON.stringify({ format: 'plakoro-nameplates', version: NAMEPLATE_VERSION, players: byPlayerKey }, null, 2)
}

// The key a nameplate is filed under. Same rule the records use, so a player resolves to the
// same entry whether the question starts from a tournament row or from an aggregated record:
// a code is the organiser's own statement of who someone is, and the name is all there is
// without one.
export function keyFor(player) {
  const code = String(player.code || '').trim().toUpperCase()
  if (code) return `code:${code}`
  return `name:${String(player.name || '').trim().toLowerCase().replace(/\s+/g, '')}`
}

// For a player the store has never seen. Everything earned reads as zero, which is accurate —
// they have not earned it here yet — and the name still shows, so the row is legible.
export function fallbackNameplate(player) {
  return {
    version: NAMEPLATE_VERSION,
    playerKey: keyFor(player),
    name: String(player.name || '').trim(),
    code: String(player.code || '').trim().toUpperCase() || null,
    avatar: FALLBACK_AVATAR,
    background: FALLBACK_BACKGROUND,
    title: null,
    medals: { gold: 0, silver: 0, bronze: 0 },
    events: 0,
    winRate: null
  }
}

// A whole store of finished nameplates, as the mock file and any future backend return them.
// Entries that don't survive validation are dropped rather than rendered — a half-read
// nameplate is a broken row, and a missing one falls back cleanly.
export function parseNameplates(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch (e) { return { ok: false, reason: 'notJson' } }
  }
  if (!data || data.format !== 'plakoro-nameplates') return { ok: false, reason: 'wrongFormat' }
  if (Number(data.version) > NAMEPLATE_VERSION) return { ok: false, reason: 'tooNew' }
  if (!data.players || typeof data.players !== 'object') return { ok: false, reason: 'malformed' }

  const players = {}
  Object.entries(data.players).forEach(([key, v]) => {
    if (!v || typeof v !== 'object' || !v.name) return
    const m = v.medals || {}
    players[key] = {
      version: NAMEPLATE_VERSION,
      playerKey: key,
      name: String(v.name),
      code: v.code ? String(v.code) : null,
      // Unknown ids fall back rather than rendering as a broken image: a store can outlive
      // the artwork it names.
      avatar: AVATARS.includes(v.avatar) ? v.avatar : FALLBACK_AVATAR,
      background: BACKGROUNDS.includes(v.background) ? v.background : FALLBACK_BACKGROUND,
      // A title is either a key the app translates, or literal text. Event-specific ones
      // ("Meetup#1 優勝") name a tournament, which no translation key can carry — so the
      // store may state the words outright. Both forms need a rank, which is what colours it.
      title: v.title && (v.title.text || v.title.key) && TITLE_RANKS.includes(v.title.rank)
        ? (v.title.text ? { text: String(v.title.text), rank: v.title.rank }
                        : { key: v.title.key, rank: v.title.rank })
        : null,
      medals: {
        gold: Number(m.gold) || 0,
        silver: Number(m.silver) || 0,
        bronze: Number(m.bronze) || 0
      },
      events: Number(v.events) || 0,
      winRate: v.winRate === null || v.winRate === undefined ? null : Number(v.winRate) || 0
    }
  })
  return { ok: true, players }
}

// A saved set of player choices. Every failure returns a reason rather than throwing — all of
// them are things the person importing can act on.
export function parseOverrides(text) {
  let data
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text
  } catch (e) {
    return { ok: false, reason: 'notJson' }
  }
  if (!data || data.format !== 'plakoro-nameplates') return { ok: false, reason: 'wrongFormat' }
  if (Number(data.version) > NAMEPLATE_VERSION) return { ok: false, reason: 'tooNew' }
  if (!data.players || typeof data.players !== 'object') return { ok: false, reason: 'malformed' }

  // Filtered on the way in, so nothing downstream has to wonder whether a stored id is real.
  const players = {}
  Object.entries(data.players).forEach(([key, v]) => {
    const clean = {}
    if (v && AVATARS.includes(v.avatar)) clean.avatar = v.avatar
    if (v && BACKGROUNDS.includes(v.background)) clean.background = v.background
    if (Object.keys(clean).length) players[key] = clean
  })
  return { ok: true, players }
}
