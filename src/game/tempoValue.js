// What it's worth to take something away from the opponent — a die, their character die,
// their damage, one of their moves — expressed in the same HP currency as the rest of the
// expected-value model, so it can be added to a move's figure rather than sitting beside it.
//
// Every one of those effects is the same question, so they share one estimator:
//
//   value = the best expected value the opponent could commit to  -  the best they can
//           commit to under the restriction
//
// It has to be a maximum over their moves at each restriction, not one move re-scored: the
// move is chosen before the dice are thrown (pickMove -> diceRoll), so a player denied a die
// picks a cheaper move rather than casting the expensive one and failing. Roughly a quarter
// of the roster does exactly that when a die is taken away.
//
// Two things this deliberately does NOT do:
//
//   - It doesn't consult the player's own dice. The opponent brings dice suited to their own
//     moves, so assuming they roll the player's build understates their baseline (a build
//     tuned for one character is a poor build for another) and halves the answer. Their build
//     is inferred from what their own moves cost instead.
//   - It doesn't recurse. Valuing the opponent's tempo moves needs a table, and building the
//     table needs the opponent's values. The way out is iteration, not recursion: the first
//     pass values their tempo moves at zero, and each later pass re-runs the whole table with
//     the previous pass's numbers standing in. Left at pass one, "you may deal no damage next
//     turn" reads as "you may do nothing next turn", which overvalues it by about a fifth.
//     Three passes reach a fixed point.
import { enumerateRolls } from './energyPayment'
import { ASSUMED_ENEMY_LAST_DAMAGE, suggestedBuild } from './suggestedDice'
import { sustainableValue } from './turnValue'
import { moveExpectedValue } from './moveExpectedValue'

// A normal turn throws 3 energy dice (the first turn of a game throws 2, which this doesn't
// model — a denial on turn one is worth more than the figure here, not less).
export const NORMAL_DICE = 3
const MAX_DICE = NORMAL_DICE + 2
const DECK_SIZE = 4
const PASSES = 3

// What the owner can sustain, under whatever restriction is being priced. The no-repeat
// rule applies to them as much as to anyone, so this is their best two alternating.
function bestCommittable(deck, dice, table, { dieCount = NORMAL_DICE, charaDiceInPlay = true, nullifyDamage = false, bannedId = null } = {}) {
  if (dieCount <= 0) return 0
  const rolls = enumerateRolls(dice.slice(0, dieCount))
  const scores = []
  deck.forEach(mv => {
    if (bannedId !== null && mv.id === bannedId) return
    const result = moveExpectedValue(mv, {
      rolls,
      enemyDice: dice.slice(0, NORMAL_DICE),
      charaDiceInPlay,
      tempoValues: table,
      enemyLastDamage: ASSUMED_ENEMY_LAST_DAMAGE
    })
    // Nullification stops the damage reaching its target; whatever the move does to its own
    // caster, and whatever tempo it buys, still happens.
    scores.push(nullifyDamage ? result.ev - result.evDamage : result.ev)
  })
  return sustainableValue(scores)
}

function tableFromPass(roster, previous) {
  const totals = {
    base: 0, denyDice1: 0, denyDice2: 0, denyCharaDie: 0,
    denyDice2AndChara: 0, nullifyDamage: 0, bindMove: 0, gainDice1: 0, gainDice2: 0
  }
  roster.forEach(({ dice, moveList }) => {
    const rolls = enumerateRolls(dice.slice(0, NORMAL_DICE))
    const scored = moveList
      .map(mv => ({
        mv,
        ev: moveExpectedValue(mv, { rolls, enemyDice: dice.slice(0, NORMAL_DICE), tempoValues: previous, enemyLastDamage: ASSUMED_ENEMY_LAST_DAMAGE }).ev
      }))
      .sort((a, b) => b.ev - a.ev)
    // The four moves they'd have brought, since a real opponent picks four, not the whole
    // list. It matters most for move-binding, whose whole value is the gap to the next best.
    const deck = scored.slice(0, DECK_SIZE).map(entry => entry.mv)
    const topId = scored.length > 0 ? scored[0].mv.id : null

    const at = opts => bestCommittable(deck, dice, previous, opts)
    const base = at({})
    totals.base += base
    totals.denyDice1 += base - at({ dieCount: NORMAL_DICE - 1 })
    totals.denyDice2 += base - at({ dieCount: NORMAL_DICE - 2 })
    totals.denyCharaDie += base - at({ charaDiceInPlay: false })
    totals.denyDice2AndChara += base - at({ dieCount: NORMAL_DICE - 2, charaDiceInPlay: false })
    totals.nullifyDamage += base - at({ nullifyDamage: true })
    totals.bindMove += base - at({ bannedId: topId })
    totals.gainDice1 += at({ dieCount: NORMAL_DICE + 1 }) - base
    totals.gainDice2 += at({ dieCount: MAX_DICE }) - base
  })

  const out = {}
  // A character whose best move ignores the character die entirely yields a small negative
  // from float noise; denying something is never worth less than nothing.
  Object.keys(totals).forEach(key => {
    out[key] = Math.max(0, totals[key] / roster.length)
  })
  return out
}

/**
 * Prices every "deny the opponent something" effect against the whole roster.
 *
 * The result is a property of the card pool, not of the player's own build, so it doesn't
 * move when they edit their dice — and it only needs computing once per data set. Roughly
 * 200ms for the printed roster, so callers should hold on to it.
 *
 * @param {Array}  characters  roster entries, each with a `moves` array of move ids
 * @param {object} movesById   every move, keyed by id
 * @returns {object} values in HP, keyed by restriction
 */
export function buildTempoTable(characters, movesById) {
  const roster = characters
    .map(character => suggestedBuild(character, movesById, MAX_DICE))
    .filter(Boolean)

  if (roster.length === 0) return null

  let table = null
  for (let pass = 0; pass < PASSES; pass++) {
    table = tableFromPass(roster, table)
  }
  return table
}
