// The dice a player would plausibly build for a given character, worked out from what that
// character's own moves are worth on them.
//
// Several things need to reason about a character on "their own" dice rather than on the
// dice the player happens to be holding — pricing what denying the opponent a die is worth,
// ranking the roster against each other — and they must all use the same build, or their
// numbers can't be compared.
//
// The main type is whichever of the types the moves name gives the best two-move rotation on
// three pure dice of it. Counting demand instead — the type the costs ask for most — is the
// obvious shortcut and agrees for fourteen of fifteen characters, but it answers the wrong
// question for フリーザー: seven of its moves are paid in みず, yet its three ひこう moves are
// its strongest, and a player who builds water gets a 27-point rotation where flying gets 32.
// The rotation is what the ranking and the deck recommendation go on to measure, so the build
// is chosen by it; nobody builds dice for the moves they won't be casting.
//
// It mirrors the two-step pure-type apply in the dice builder, and for the same reason: the
// two fixed faces draw from different pools, so no single type can fill both. The main type
// takes both sockets and whichever fixed face can hold it; the secondary fills the other
// face, chosen by demand from the pool that face is limited to — it is one face in six, and
// which of the leftover moves it happens to enable is not worth a second search.
import { CONVEX_TYPES, CONCAVE_TYPES } from './diceParts'
import { enumerateRolls } from './energyPayment'
import { moveExpectedValue } from './moveExpectedValue'
import { sustainableValue } from './turnValue'

export const COLORLESS = '無色'

// What to assume the opponent last cast, for the one move that copies its printed damage.
//
// It is a deliberate over-estimate: the roster's median printed damage is 20, and 40 is
// nearer the top of what gets cast. Copying is only worth doing after the opponent commits
// something worth copying, so the interesting question is what the move is worth when the
// player would actually reach for it, not what it averages against a random turn. The odds
// view exposes the figure so it can be dialled down.
export const ASSUMED_ENEMY_LAST_DAMAGE = 40

// Candidate builds are judged on a normal turn's throw. The caller may ask for more dice
// (the tempo table prices "gain a die" on five), but the build is the same either way.
const JUDGED_DICE = 3

// A rotation has to beat the incumbent by this much to take the build over; anything closer
// is float noise, and the tie goes to the more demanded type.
const TIE_HP = 0.05

// Every type the moves name, most demanded first. Colourless is payable by anything, so it
// says nothing about which type to build towards.
function demandedTypes(moveList, pool) {
  const tally = new Map()
  moveList.forEach(mv => mv.cost.forEach(type => {
    if (type === COLORLESS) return
    if (pool && !pool.includes(type)) return
    tally.set(type, (tally.get(type) || 0) + 1)
  }))
  return [...tally]
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type)
}

function mostDemanded(moveList, pool) {
  return demandedTypes(moveList, pool)[0] || null
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

// Whichever pool the main type left unfilled. A character whose moves never ask for that
// pool gets its first entry — arbitrary, but so is the choice when nothing depends on it.
function secondaryFor(mainType, moveList) {
  const otherPool = CONVEX_TYPES.includes(mainType) ? CONCAVE_TYPES : CONVEX_TYPES
  return mostDemanded(moveList, otherPool) || otherPool[0]
}

// What the character's best two moves alternate for on three pure dice of `mainType`.
//
// Valued without a tempo table: the table is itself built from these builds, so it can't be
// an input to them. Denial effects therefore count for nothing here, and reduction counts as
// HP kept, as it does in the ranking. Neither choice moves the answer for the printed roster
// — the build that wins with them is the build that wins without.
function rotationOn(mainType, moveList) {
  const dice = Array.from({ length: JUDGED_DICE }, () => pureDie(mainType, secondaryFor(mainType, moveList)))
  const rolls = enumerateRolls(dice)
  const scores = moveList.map(mv => moveExpectedValue(mv, {
    rolls,
    enemyDice: dice,
    countDefensiveValue: true,
    enemyLastDamage: ASSUMED_ENEMY_LAST_DAMAGE
  }).ev)
  return sustainableValue(scores)
}

function bestMainType(moveList) {
  let best = null
  let bestScore = -Infinity
  demandedTypes(moveList, null).forEach(type => {
    const score = rotationOn(type, moveList)
    if (best === null || score > bestScore + TIE_HP) {
      best = type
      bestScore = score
    }
  })
  return best
}

/**
 * @param {object} character  a roster entry, with `moves` as a list of ids
 * @param {object} movesById  every move, keyed by id
 * @param {number} [count]    how many dice to return (a normal turn throws 3)
 * @returns {{mainType, secondaryType, dice, moveList}|null} null if the character has no
 *          moves, or none that name a type — nothing to build towards.
 */
export function suggestedBuild(character, movesById, count = JUDGED_DICE) {
  const moveList = (character.moves || []).map(id => movesById[id]).filter(Boolean)
  if (moveList.length === 0) return null

  const mainType = bestMainType(moveList) || character.type
  if (!mainType) return null

  const secondaryType = secondaryFor(mainType, moveList)
  const die = pureDie(mainType, secondaryType)
  return { mainType, secondaryType, moveList, dice: Array.from({ length: count }, () => die) }
}
