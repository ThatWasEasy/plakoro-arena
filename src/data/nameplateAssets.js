// Every piece of nameplate artwork, keyed by id.
//
// Read off the folders rather than listed by hand: a new season is four files for the flag and
// four for the avatar, and a list that has to be edited alongside them is a list that will one
// day be edited wrong. Dropping a file in is the whole of adding an asset.
//
// The id is the filename without its extension — `2026-10-champion`, `perfect-mascot`. That is
// what gets stored on a nameplate, so it has to stay stable: renaming a file renames the id and
// orphans every nameplate pointing at it.
//
// Shared by the screen and the PNG export, so the two cannot disagree about what exists.

function registry(modules) {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [
      path.split('/').pop().replace(/\.\w+$/, ''),
      url
    ])
  )
}

// The options have to be written out at each call: Vite reads these statically at build time,
// so a shared variable is not something it can follow.
export const BACKGROUND_URLS = registry(
  import.meta.glob('../assets/banner-bg/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }))

export const AVATAR_URLS = registry(
  import.meta.glob('../assets/avatar/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }))

// Optional overlay. Most tiers have none, and that is the normal case rather than a gap.
export const AVATAR_BORDER_URLS = registry(
  import.meta.glob('../assets/avatar-border/*.{png,webp}', { eager: true, query: '?url', import: 'default' }))

export const BACKGROUND_IDS = Object.keys(BACKGROUND_URLS)
export const AVATAR_IDS = Object.keys(AVATAR_URLS)

// Which season's artwork a fresh record (or a player who never set one) gets. Lives here,
// not in playerNameplate.js, so the fallback ids below can follow it without an import cycle.
export const CURRENT_SEASON = '2026-10'

// What a nameplate falls back to when its stored id names artwork that no longer exists — a
// season's files removed, a filename changed — and what a brand new record gets before it has
// earned anything.
//
// Has to be the *current* season's `-default`, not just any `-default`: season ids sort as
// strings ("2026-10" before "2026-9", because '1' < '9'), so picking "whichever sorts first"
// drifts away from CURRENT_SEASON the moment a season number needs two digits again — new
// players would keep the old flag while existing ones moved to the new one. Only falls back to
// that sort order if the current season's own file hasn't been dropped in yet.
export const FALLBACK_BACKGROUND = BACKGROUND_URLS[`${CURRENT_SEASON}-default`]
  ? `${CURRENT_SEASON}-default`
  : (BACKGROUND_IDS.find(id => id.endsWith('-default')) || BACKGROUND_IDS[0])
export const FALLBACK_AVATAR = AVATAR_URLS[`${CURRENT_SEASON}-default`]
  ? `${CURRENT_SEASON}-default`
  : (AVATAR_IDS.find(id => id.endsWith('-default')) || AVATAR_IDS[0])

export function backgroundUrl(id) {
  return BACKGROUND_URLS[id] || BACKGROUND_URLS[FALLBACK_BACKGROUND]
}

export function avatarUrl(id) {
  return AVATAR_URLS[id] || AVATAR_URLS[FALLBACK_AVATAR]
}

export function avatarBorderUrl(id) {
  return AVATAR_BORDER_URLS[id] || null
}

// Seasonal tier ids look like `2026-10-champion`; the three mascots have no tier suffix at all —
// they're earned some other way, not simply "public." Used to gate the profile screen's pickers
// so a brand new account isn't handed artwork (tiered or not) it hasn't earned. `null` here means
// "not a seasonal tier," not "free for everyone" — see PlayerProfileApp.vue's isUnlocked().
const TIER_SUFFIX = /-(default|participants|winner|champion)$/

export function tierOfAsset(id) {
  const m = TIER_SUFFIX.exec(id)
  return m ? m[1] : null
}

// Every season that actually has artwork, for anything that needs to ask "which season's
// rewards" rather than assume it's always the current one — an admin uploading a tournament
// that happened last season is the reason this exists; defaulting to CURRENT_SEASON there would
// hand out this season's gear for a result that was never meant to earn it.
const ALL_SEASONS = [...new Set(
  BACKGROUND_IDS.map(id => {
    const m = TIER_SUFFIX.exec(id)
    return m ? id.slice(0, m.index) : null
  }).filter(Boolean)
)]
export const SEASONS = [CURRENT_SEASON, ...ALL_SEASONS.filter(s => s !== CURRENT_SEASON)]
