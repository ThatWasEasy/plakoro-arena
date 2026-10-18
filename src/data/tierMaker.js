const TIER_MAKER_STORAGE_KEY = "plakoro_tier_maker_v3"

// A new tier cycles through this palette by how many tiers already exist, so the player never
// has to pick a colour just to add a row — the classic S/A/B/C/D set first, then it repeats.
export const TIER_PALETTE = ["#ff7f7f", "#ffbf7f", "#ffdf7f", "#bfff7f", "#7fbfff", "#bf7fff", "#ff7fbf", "#bfbfbf"]

export function defaultTiers() {
  return [
    { id: "tier-s", label: "S", color: TIER_PALETTE[0] },
    { id: "tier-a", label: "A", color: TIER_PALETTE[1] },
    { id: "tier-b", label: "B", color: TIER_PALETTE[2] },
    { id: "tier-c", label: "C", color: TIER_PALETTE[3] },
    { id: "tier-d", label: "D", color: TIER_PALETTE[4] }
  ]
}

// An instance used to carry one `type`; it now carries `types`, up to two, because a Pokémon
// here can be single- or dual-typed. Migrated on read rather than by bumping the storage key:
// the key holds somebody's whole tier list, and throwing that away to change the shape of one
// field would be a poor trade.
function withTypesArray(entries) {
  const out = {}
  for (const [tierId, list] of Object.entries(entries)) {
    out[tierId] = (Array.isArray(list) ? list : []).map(e => {
      if (Array.isArray(e.types)) return e
      const { type, ...rest } = e
      return { ...rest, types: type ? [type] : [] }
    })
  }
  return out
}

export function loadTierMaker() {
  try {
    const raw = localStorage.getItem(TIER_MAKER_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || !Array.isArray(parsed.tiers) || typeof parsed.entries !== "object") return null
    return { ...parsed, entries: withTypesArray(parsed.entries) }
  } catch (e) {
    return null
  }
}

export function saveTierMaker(state) {
  try {
    localStorage.setItem(TIER_MAKER_STORAGE_KEY, JSON.stringify(state))
  } catch (e) {}
}

export function newInstanceId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
