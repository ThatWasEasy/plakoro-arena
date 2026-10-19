// Remembers the last dice build the player assembled in the Dice Assembly Simulator, so
// reopening it doesn't start from a fresh random roll every time — see DiceBuilderApp.vue's
// `sets` ref, which this mirrors exactly (one entry for set A, a second only while "compare"
// is on).
import { CONVEX_TYPES, CONCAVE_TYPES, CHIP_TYPES } from '../game/diceParts'

const STORAGE_KEY = 'plakoro_dice_builder_v1'

function isValidSingleSlot(s) {
  return s && s.kind === 'single' && CHIP_TYPES.includes(s.type)
}

function isValidDualSlot(s) {
  return s && s.kind === 'dual' && Array.isArray(s.types) && s.types.length === 2 &&
    s.types.every(t => CHIP_TYPES.includes(t))
}

function isValidDie(die) {
  return die &&
    CONVEX_TYPES.includes(die.convexType) &&
    CONCAVE_TYPES.includes(die.concaveType) &&
    Array.isArray(die.singleSlots) && die.singleSlots.length === 2 && die.singleSlots.every(isValidSingleSlot) &&
    Array.isArray(die.dualSlots) && die.dualSlots.length === 2 && die.dualSlots.every(isValidDualSlot)
}

function isValidSet(set) {
  return set &&
    Array.isArray(set.dice) && set.dice.length === 3 && set.dice.every(isValidDie) &&
    Array.isArray(set.sameAsDie1) && set.sameAsDie1.length === 2
}

/**
 * The saved `sets` array, or null if nothing is saved or what's there no longer matches the
 * current shape (a face pool that's since changed, a half-written value from a failed save) —
 * null tells the caller to fall back to a fresh random build rather than trusting a value this
 * version of the game might not know how to read.
 */
export function loadSavedSets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2 || !parsed.every(isValidSet)) return null
    return parsed
  } catch (e) {
    return null
  }
}

export function saveSets(sets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets))
  } catch (e) {
    // A full or disabled store just means the build won't survive a reload.
  }
}
