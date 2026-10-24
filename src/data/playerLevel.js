// A player's level.
//
// The field exists before the rule does, on purpose: the corner of the home screen is where it
// has to fit, and finding that out after designing how levelling works is the wrong order. What
// makes somebody level up is still an open question (see the API repo's docs/todo.md).
//
// Everyone is Lv.1 until that question is answered. One place to change when it is.
import { computed } from 'vue'
import { isSignedIn } from './currentPlayer'

export const STARTING_LEVEL = 1

// Null for a guest rather than 1 — a guest has no record to have earned a level from, and the
// chip hides the line rather than showing one that means nothing.
export const playerLevel = computed(() => (isSignedIn.value ? STARTING_LEVEL : null))
