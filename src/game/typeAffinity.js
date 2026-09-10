// Which energy types a character actually plays, read off their own move list.
//
// The printed character type is not that answer. イーブイ is printed 無色 and has five 無色
// moves, but four of its moves are paid for in ひこう — a player building dice for it builds
// flying, and a player reading the roster wants to be told flying. So the tally is taken over
// the energy each move demands, not over the type printed on the move or the character.
//
// Colourless is skipped: every die face pays it, so it says nothing about what to build or
// what the character leans on.
//
// Moves are counted, not energy symbols. A single move costing three ひこう is one flying move,
// not three — "this character has a lot of flying moves" is a claim about the kit, and counting
// symbols would let one expensive card outvote three cheap ones.
import { COLORLESS } from './suggestedDice'

/**
 * Every type the character's moves ask for, most-played first.
 *
 * @param {Array} moveList  the character's moves, each with a `cost` array of type names
 * @returns {Array<{type: string, moves: number}>}
 */
export function energyDemand(moveList) {
  const tally = new Map()
  moveList.forEach(mv => {
    // A move that costs two ひこう and one かくとう counts once for each, not twice for flying.
    new Set(mv.cost || []).forEach(type => {
      if (type === COLORLESS) return
      tally.set(type, (tally.get(type) || 0) + 1)
    })
  })
  return [...tally]
    .map(([type, moves]) => ({ type, moves }))
    .sort((a, b) => b.moves - a.moves || a.type.localeCompare(b.type))
}

/**
 * The character's main and secondary types, with ties kept.
 *
 * Ties are reported rather than broken. イーブイ's second type is a genuine one-all draw
 * between あく and ちょう, and picking one by tally order would print a confident answer the
 * data doesn't support — the reader can see the draw and decide which they'd rather build.
 *
 * @returns {{main: string[], secondary: string[], demand: Array}} `main` and `secondary` hold
 *          every type tied at that rank, and are empty when the character has no demand at all
 *          (every move colourless).
 */
export function typeAffinity(moveList) {
  const demand = energyDemand(moveList)
  if (demand.length === 0) return { main: [], secondary: [], demand }
  const topCount = demand[0].moves
  const main = demand.filter(entry => entry.moves === topCount).map(entry => entry.type)
  // A tie for first leaves no second place: those types are already all on the main line, and
  // inventing a third rank to fill the slot would misreport the kit.
  const rest = demand.filter(entry => entry.moves < topCount)
  const secondCount = rest.length > 0 ? rest[0].moves : 0
  const secondary = rest.filter(entry => entry.moves === secondCount).map(entry => entry.type)
  return { main, secondary, demand }
}
