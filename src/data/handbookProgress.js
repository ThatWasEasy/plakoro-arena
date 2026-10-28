// How far through each chapter the reader got.
//
// Kept on the device, not the server: it is a convenience, not an entitlement, and the server
// has no business storing what page someone is on. Losing it costs a scroll.
//
// A 190-page book split across 27 chapters is unusable without this — "continue where I left
// off" is the difference between a shelf and a pile.
import { ref } from 'vue'

const KEY = 'plakoro_handbook_progress_v1'

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    return raw && typeof raw === 'object' ? raw : {}
  } catch (e) {
    return {}
  }
}

// One ref for the whole map, so the shelf re-renders the moment the reader closes.
const state = ref(load())

export const progress = state

/** The page last seen in `unitId`, 1-based; 0 when it has never been opened. */
export function pageOf(unitId) {
  return state.value[unitId]?.page || 0
}

/** Whether a chapter has been opened at all — what separates "yours" from "started". */
export function startedOf(unitId) {
  return !!state.value[unitId]
}

/**
 * Remember where the reader is.
 *
 * `at` is the timestamp rather than a counter so "most recent" survives a chapter being
 * reopened and closed again without advancing.
 */
export function setProgress(unitId, page, pages) {
  if (!unitId || !page) return
  state.value = { ...state.value, [unitId]: { page, pages, at: Date.now() } }
  try {
    localStorage.setItem(KEY, JSON.stringify(state.value))
  } catch (e) {
    // A reading position that does not survive a reload is not worth failing over.
  }
}

/** The chapter to offer as "continue reading", or null when nothing has been opened. */
export function mostRecent(units) {
  let best = null
  for (const u of units) {
    const p = state.value[u.id]
    if (!p) continue
    if (!best || p.at > best.at) best = { ...p, unit: u }
  }
  return best
}
