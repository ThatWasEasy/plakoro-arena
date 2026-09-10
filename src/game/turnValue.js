// What a stretch of turns is worth, given that nobody gets to keep casting their best move.
//
// A move used last turn is locked out of this one — MovesGrid disables the card whose id
// matches `committedLastMoveId` — so the sustainable pattern is the best two moves
// alternating, and the value of a turn is their average rather than the maximum.
//
// Taking the maximum instead is not a small error. Applied to a whole game it says every
// character casts their single strongest move every turn, which collapses any per-turn
// measure into "whose best move scores highest" and throws away everything about the depth
// of their kit; three characters come out at exactly the same figure that way, because it is
// literally the same number three times.
//
// Two is the floor rather than a tuning knob: it is what the no-repeat rule forces. A third
// slot only earns its place when a move can be taken away — the opponent locking one out
// with 「相手のワザを１つ選ぶ」 — which is why it's offered rather than assumed.
export const SUSTAINABLE_SLOTS = 2

/**
 * Mean of the best `slots` scores, or of all of them when there are fewer.
 *
 * @param {number[]} scores  one value per available move
 * @param {number}   [slots] how many moves the rotation actually gets through
 */
export function sustainableValue(scores, slots = SUSTAINABLE_SLOTS) {
  if (!scores || scores.length === 0) return 0
  const top = [...scores].sort((a, b) => b - a).slice(0, slots)
  return top.reduce((sum, value) => sum + value, 0) / top.length
}

/**
 * The same rotation, but keeping the entries so a caller can show which moves it picked.
 *
 * @param {Array} entries  objects carrying the score under `key`
 */
export function sustainableTop(entries, slots = SUSTAINABLE_SLOTS, key = 'ev') {
  return [...entries].sort((a, b) => b[key] - a[key]).slice(0, slots)
}
