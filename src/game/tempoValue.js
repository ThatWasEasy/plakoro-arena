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
//
// One more thing it does NOT do: average over everybody. See REFERENCE_COUNT.
import { enumerateRolls, parseCost } from './energyPayment'
import { CHIP_TYPES, FACE_KEYS, faceTypes } from './diceParts'
import { ASSUMED_ENEMY_LAST_DAMAGE, suggestedBuild } from './suggestedDice'
import { sustainableValue, DECK_SIZE, NORMAL_DICE } from './turnValue'
import { moveExpectedValue, nullifyAtMostKey } from './moveExpectedValue'

// The first turn of a game throws 2 dice, which this doesn't model — a denial on turn one is
// worth more than the figure here, not less.
const MAX_DICE = NORMAL_DICE + 2
const PASSES = 3

// How many opponents each price is averaged over, strongest first.
//
// Averaging over the whole roster answers "against an unknown opponent", and that is the
// wrong question for a figure read before a tournament: the opponent is someone's best pick,
// and the bottom third of the roster drags the mean down by about a fifth. Denying a die
// prices at 8.7 averaged over all fifteen, 9.6 over the strongest eight, 10.2 over the
// strongest five.
//
// Narrowing further stops helping. At three the answer is hostage to a single card, and the
// table stops moving in one direction — denying a die gets dearer while denying the
// character die gets cheaper and handing out dice gets worth less. That is noise, not a
// sharper read on the meta, and a table whose rows assume different opponents can't be
// compared row to row.
export const REFERENCE_COUNT = 5

// How likely `cost` is to be paid when, after the throw, the opponent may pick up to `n` of
// the dice and have them thrown again (REROLL_DICE_ENEMY) — and picks whichever ones make the
// re-throw least likely to still pay. A roll that already fails is left alone: re-throwing it
// could only help the thrower.
//
// It enumerates every per-die outcome and every choice of dice, which is ~27k cost checks per
// move for three dice, so faces are counted into fixed-length vectors once and the check
// itself is a few array reads. Memoised on the dice and cost, since passes re-ask it.
const enemyRerollMemo = new Map()
export function payableUnderEnemyReroll(dice, cost, n) {
  if (!cost || cost.length === 0) return 1
  const memoKey = JSON.stringify([dice, cost, n])
  if (enemyRerollMemo.has(memoKey)) return enemyRerollMemo.get(memoKey)

  const typeIndex = new Map(CHIP_TYPES.map((type, i) => [type, i]))
  const width = CHIP_TYPES.length
  const { specific, colorless } = parseCost(cost)
  const need = new Array(width).fill(0)
  let needTotal = 0
  for (const [type, count] of specific) {
    // A cost no chip can ever show is never payable.
    if (!typeIndex.has(type)) {
      enemyRerollMemo.set(memoKey, 0)
      return 0
    }
    need[typeIndex.get(type)] = count
    needTotal += count
  }
  const faces = dice.map(die => FACE_KEYS.map(key => {
    const types = faceTypes(die, key)
    const vec = new Array(width).fill(0)
    types.forEach(type => { vec[typeIndex.get(type)] += 1 })
    return { vec, size: types.length }
  }))
  const pays = picked => {
    let size = 0
    for (let t = 0; t < width; t++) {
      if (need[t] === 0) continue
      let have = 0
      for (let d = 0; d < picked.length; d++) have += picked[d].vec[t]
      if (have < need[t]) return false
    }
    for (let d = 0; d < picked.length; d++) size += picked[d].size
    return size - needTotal >= colorless
  }

  const dieCount = dice.length
  const subsets = []
  for (let mask = 1; mask < (1 << dieCount); mask++) {
    const members = []
    for (let d = 0; d < dieCount; d++) if (mask & (1 << d)) members.push(d)
    if (members.length <= n) subsets.push(members)
  }

  // Share of re-throws of `members` that still pay, with every other die held at `roll`.
  const stillPays = (roll, members) => {
    const current = roll.map((faceIdx, d) => faces[d][faceIdx])
    let paying = 0
    let total = 0
    const walk = k => {
      if (k === members.length) {
        total += 1
        if (pays(current)) paying += 1
        return
      }
      const d = members[k]
      for (let f = 0; f < FACE_KEYS.length; f++) {
        current[d] = faces[d][f]
        walk(k + 1)
      }
      current[d] = faces[d][roll[d]]
    }
    walk(0)
    return paying / total
  }

  let sum = 0
  let outcomes = 0
  const roll = new Array(dieCount).fill(0)
  const visit = d => {
    if (d === dieCount) {
      outcomes += 1
      if (!pays(roll.map((faceIdx, i) => faces[i][faceIdx]))) return
      let best = 1
      subsets.forEach(members => { best = Math.min(best, stillPays(roll, members)) })
      sum += best
      return
    }
    for (let f = 0; f < FACE_KEYS.length; f++) {
      roll[d] = f
      visit(d + 1)
    }
  }
  visit(0)
  const result = outcomes > 0 ? sum / outcomes : 0
  enemyRerollMemo.set(memoKey, result)
  return result
}

// Every NULLIFY_TAKEN_LE threshold printed in the roster, so the table prices each one.
function nullifyThresholds(roster) {
  const out = new Set()
  roster.forEach(({ moveList }) => moveList.forEach(mv => {
    if (mv.effectType === 'NULLIFY_TAKEN_LE') out.add(mv.effectValue)
    mv.chara.forEach(ce => { if (ce.type === 'NULLIFY_TAKEN_LE') out.add(ce.value) })
  }))
  return [...out]
}

// What the owner can sustain, under whatever restriction is being priced. The no-repeat
// rule applies to them as much as to anyone, so this is their best two alternating.
//
// The newer restrictions, each keyed the same way:
//   - `nullifyAtMost`: hits of that size or less are dropped (NULLIFY_TAKEN_LE), read off the
//     move's own branches so a character-die bonus that clears the bar still lands.
//   - `enemyReroll`: the opponent re-throws up to that many of the owner's dice after seeing
//     them (REROLL_DICE_ENEMY). The move's value is scaled by how much of its payability
//     survives — linear in the success rate, which every effect but a repeat already is.
//   - `charaRerolls`: the owner may re-throw their own character die (REROLL_CHARADICE_SELF).
//   - `forcedWorst`: the opponent picks the owner's move (SPECIAL_PICK_ENEMY_WAZA), and picks
//     the least of the four. One turn, not a rotation, so it's the worst score rather than a
//     sustainable pair.
function bestCommittable(deck, dice, table, { dieCount = NORMAL_DICE, charaDiceInPlay = true, nullifyDamage = false, bannedId = null, countDefensiveValue = true, nullifyAtMost = null, enemyReroll = 0, charaRerolls = 0, forcedWorst = false } = {}) {
  if (dieCount <= 0) return 0
  const thrown = dice.slice(0, dieCount)
  const rolls = enumerateRolls(thrown)
  const scores = []
  deck.forEach(mv => {
    if (bannedId !== null && mv.id === bannedId) return
    const result = moveExpectedValue(mv, {
      rolls,
      enemyDice: dice.slice(0, NORMAL_DICE),
      charaDiceInPlay,
      tempoValues: table,
      countDefensiveValue,
      enemyLastDamage: ASSUMED_ENEMY_LAST_DAMAGE,
      charaRerolls
    })
    // Nullification stops the damage reaching its target; whatever the move does to its own
    // caster, and whatever tempo it buys, still happens.
    let score = nullifyDamage ? result.ev - result.evDamage : result.ev
    if (nullifyAtMost !== null) {
      const dropped = result.branches.reduce((sum, b) => sum + (b.damage <= nullifyAtMost ? b.probability * b.damage : 0), 0)
      score -= result.pSuccess * dropped
    }
    if (enemyReroll > 0 && result.pSuccess > 0) {
      score *= payableUnderEnemyReroll(thrown, mv.cost, enemyReroll) / result.pSuccess
    }
    scores.push(score)
  })
  if (forcedWorst) return scores.length > 0 ? Math.min(...scores) : 0
  return sustainableValue(scores)
}

// What one restriction costs the strongest few opponents, which is what the caster is
// buying. Two filters, in this order:
//
//   - A character who *gains* from a restriction says nothing about what that restriction
//     costs. ファイヤー's もえつきる takes -80 on three of its character die's six faces, so
//     blocking that die is a gift worth 3.0 to them — averaging that gift in prices "block
//     their character die" below what it costs everyone else. Beneficiaries are dropped per
//     key rather than by name, so a future card of the same shape is handled without a
//     special case, and a character only drops out of the keys it actually benefits from:
//     ファイヤー is still the worst-hit on the combined dice-and-character-die row and counts
//     there. If a restriction somehow helps everyone, the unfiltered roster is used rather
//     than nothing.
//   - Of whoever is left, the strongest REFERENCE_COUNT by what they can commit to. Strength
//     is the ranking key, not the size of the drop — sorting by the drop itself would pick
//     the opponents a restriction happens to hurt most, which is a way of assuming the
//     answer.
function referenceMean(rows, key) {
  const hurt = rows.filter(row => row[key] > 0)
  const pool = (hurt.length > 0 ? hurt : [...rows])
    .sort((a, b) => b.base - a.base)
    .slice(0, REFERENCE_COUNT)
  if (pool.length === 0) return 0
  // A restriction is never worth less than nothing to whoever imposes it: they can decline
  // to use it, and the float noise from a character who ignores the die outright is not a
  // reason to pay them.
  return Math.max(0, pool.reduce((sum, row) => sum + row[key], 0) / pool.length)
}

function tableFromPass(roster, previous, countDefensiveValue) {
  const rows = []
  const thresholds = nullifyThresholds(roster)
  roster.forEach(({ dice, moveList }) => {
    const rolls = enumerateRolls(dice.slice(0, NORMAL_DICE))
    const scored = moveList
      .map(mv => ({
        mv,
        ev: moveExpectedValue(mv, { rolls, enemyDice: dice.slice(0, NORMAL_DICE), tempoValues: previous, countDefensiveValue, enemyLastDamage: ASSUMED_ENEMY_LAST_DAMAGE }).ev
      }))
      .sort((a, b) => b.ev - a.ev)
    // The four moves they'd have brought, since a real opponent picks four, not the whole
    // list. It matters most for move-binding, whose whole value is the gap to the next best.
    const deck = scored.slice(0, DECK_SIZE).map(entry => entry.mv)
    const topId = scored.length > 0 ? scored[0].mv.id : null

    const at = opts => bestCommittable(deck, dice, previous, { ...opts, countDefensiveValue })
    const base = at({})
    rows.push({
      base,
      denyDice1: base - at({ dieCount: NORMAL_DICE - 1 }),
      denyDice2: base - at({ dieCount: NORMAL_DICE - 2 }),
      denyCharaDie: base - at({ charaDiceInPlay: false }),
      denyDice2AndChara: base - at({ dieCount: NORMAL_DICE - 2, charaDiceInPlay: false }),
      nullifyDamage: base - at({ nullifyDamage: true }),
      bindMove: base - at({ bannedId: topId }),
      pickEnemyMove: base - at({ forcedWorst: true }),
      rerollEnemyDice1: base - at({ enemyReroll: 1 }),
      rerollEnemyDice2: base - at({ enemyReroll: 2 }),
      gainDice1: at({ dieCount: NORMAL_DICE + 1 }) - base,
      gainDice2: at({ dieCount: MAX_DICE }) - base,
      gainCharaReroll1: at({ charaRerolls: 1 }) - base,
      gainCharaReroll2: at({ charaRerolls: 2 }) - base,
      ...Object.fromEntries(thresholds.map(limit => [nullifyAtMostKey(limit), base - at({ nullifyAtMost: limit })]))
    })
  })

  const out = {}
  Object.keys(rows[0] || {}).forEach(key => {
    out[key] = referenceMean(rows, key)
  })
  return out
}

/**
 * Prices every "deny the opponent something" effect against the strongest few of the roster.
 *
 * The result is a property of the card pool, not of the player's own build, so it doesn't
 * move when they edit their dice — and it only needs computing once per data set. Roughly
 * 200ms for the printed roster, so callers should hold on to it.
 *
 * @param {Array}  characters  roster entries, each with a `moves` array of move ids
 * @param {object} movesById   every move, keyed by id
 * @returns {object} values in HP, keyed by restriction
 */
export function buildTempoTable(characters, movesById, options = {}) {
  // Damage reduction is HP kept, and what a denial costs is measured in the same currency as
  // everything the opponent could otherwise have done — so it counts here for the same reason
  // it counts in the tier list. Leaving it out understated the baseline for the three
  // characters built around it: イワーク's best committable turn is 26.3 without it and 34.5
  // with, and a die taken from them is worth accordingly more.
  const { countDefensiveValue = true } = options

  const roster = characters
    .map(character => suggestedBuild(character, movesById, MAX_DICE))
    .filter(Boolean)

  if (roster.length === 0) return null

  let table = null
  for (let pass = 0; pass < PASSES; pass++) {
    table = tableFromPass(roster, table, countDefensiveValue)
  }
  return table
}
