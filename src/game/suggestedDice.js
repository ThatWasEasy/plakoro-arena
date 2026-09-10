// The dice a player would plausibly build for a given character, worked out from what that
// character's own moves actually cost.
//
// Several things need to reason about a character on "their own" dice rather than on the
// dice the player happens to be holding — pricing what denying the opponent a die is worth,
// ranking the roster against each other — and they must all use the same build, or their
// numbers can't be compared.
//
// It mirrors the two-step pure-type apply in the dice builder, and for the same reason: the
// two fixed faces draw from different pools, so no single type can fill both. The main type
// takes both sockets and whichever fixed face can hold it; the secondary fills the other
// face, chosen the same way from the pool that face is limited to.
import { CONVEX_TYPES, CONCAVE_TYPES } from './diceParts'

export const COLORLESS = '無色'

// What to assume the opponent last cast, for the one move that copies its printed damage.
//
// It is a deliberate over-estimate: the roster's median printed damage is 20, and 40 is
// nearer the top of what gets cast. Copying is only worth doing after the opponent commits
// something worth copying, so the interesting question is what the move is worth when the
// player would actually reach for it, not what it averages against a random turn. The odds
// view exposes the figure so it can be dialled down.
export const ASSUMED_ENEMY_LAST_DAMAGE = 40

// Colourless is payable by anything, so it says nothing about which type to build towards.
function mostDemanded(moveList, pool) {
  const tally = new Map()
  moveList.forEach(mv => mv.cost.forEach(type => {
    if (type === COLORLESS) return
    if (pool && !pool.includes(type)) return
    tally.set(type, (tally.get(type) || 0) + 1)
  }))
  let best = null
  let bestCount = 0
  tally.forEach((count, type) => {
    if (count > bestCount) {
      bestCount = count
      best = type
    }
  })
  return best
}

export function pureDie(mainType, secondaryType) {
  const mainIsConvex = CONVEX_TYPES.includes(mainType)
  return {
    convexType: mainIsConvex ? mainType : secondaryType,
    concaveType: mainIsConvex ? secondaryType : mainType,
    singleSlots: [{ type: mainType }, { type: mainType }],
    dualSlots: [{ types: [mainType, mainType] }, { types: [mainType, mainType] }]
  }
}

/**
 * @param {object} character  a roster entry, with `moves` as a list of ids
 * @param {object} movesById  every move, keyed by id
 * @param {number} [count]    how many dice to return (a normal turn throws 3)
 * @returns {{mainType, secondaryType, dice, moveList}|null} null if the character has no
 *          moves, or none that name a type — nothing to build towards.
 */
export function suggestedBuild(character, movesById, count = 3) {
  const moveList = (character.moves || []).map(id => movesById[id]).filter(Boolean)
  if (moveList.length === 0) return null

  const mainType = mostDemanded(moveList, null) || character.type
  if (!mainType) return null

  // Whichever pool the main type left unfilled. A character whose moves never ask for that
  // pool gets its first entry — arbitrary, but so is the choice when nothing depends on it.
  const otherPool = CONVEX_TYPES.includes(mainType) ? CONCAVE_TYPES : CONVEX_TYPES
  const secondaryType = mostDemanded(moveList, otherPool) || otherPool[0]

  const die = pureDie(mainType, secondaryType)
  return { mainType, secondaryType, moveList, dice: Array.from({ length: count }, () => die) }
}
