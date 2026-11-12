// Works out how likely a move is to be payable by a given set of assembled energy dice.
//
// A move's cost is a list of energy types, where "無色" (colorless) is a wildcard any energy
// can pay for. Note that colorless is never a face type — the 9 chip types are the only thing
// a die can roll (see CHIP_TYPES) — so it only ever appears on the cost side.
import { FACE_KEYS, faceTypes } from './diceParts'

export const COLORLESS = "無色"

// Splits a cost list into its specific-type requirements and its wildcard count.
export function parseCost(cost) {
  const specific = new Map()
  let colorless = 0
  cost.forEach(type => {
    if (type === COLORLESS) colorless += 1
    else specific.set(type, (specific.get(type) || 0) + 1)
  })
  return { specific, colorless }
}

// Whether one roll's energy can pay a cost.
//
// No bipartite matching is needed here: a specific requirement can only ever be paid by its
// own type, and a wildcard by anything. So paying every specific requirement from its own
// type first is never worse than any alternative, and whatever is left over is exactly what's
// available for the wildcards. Checking "enough of each type" plus "enough left over" is
// therefore both necessary and sufficient.
export function canPayCost(rolledTypes, cost) {
  const { specific, colorless } = parseCost(cost)
  const have = new Map()
  rolledTypes.forEach(type => have.set(type, (have.get(type) || 0) + 1))

  let specificTotal = 0
  for (const [type, needed] of specific) {
    if ((have.get(type) || 0) < needed) return false
    specificTotal += needed
  }
  return rolledTypes.length - specificTotal >= colorless
}

// Every possible outcome of rolling the given dice together, as a flat list of energy types
// per outcome. Each die contributes one face, so there are 6^n equally likely outcomes —
// 36 for two dice, 216 for three. Written as an iterative product rather than nested loops
// because the player chooses how many (and which) dice take part.
export function enumerateRolls(dice) {
  let outcomes = [[]]
  dice.forEach(die => {
    const next = []
    outcomes.forEach(prefix => {
      FACE_KEYS.forEach(faceKey => {
        next.push([...prefix, ...faceTypes(die, faceKey)])
      })
    })
    outcomes = next
  })
  return outcomes
}

// How many of the given rolls can pay the cost, plus the total, so callers can render the
// raw tally as well as the percentage. A move with no cost at all counts as always payable.
export function payableCount(rolls, cost) {
  if (!cost || cost.length === 0) return { payable: rolls.length, total: rolls.length }
  let payable = 0
  rolls.forEach(roll => {
    if (canPayCost(roll, cost)) payable += 1
  })
  return { payable, total: rolls.length }
}

// A character-die effect fires when the die lands on any of its listed orientations, out of
// the character die's 6 faces.
export const CHARA_DIE_FACE_COUNT = 6

export function charaEffectOdds(orientations) {
  const hits = Array.isArray(orientations) ? orientations.length : 0
  return { hits, total: CHARA_DIE_FACE_COUNT }
}

// How likely a character-die effect is to actually go off. The effect rides on a separate die,
// but it only matters if the move itself lands — a move that can't be paid for never reaches
// the character-die check. So the real figure is the joint probability of both, and a move at
// 80% with a 3-of-6 effect fires 40% of the time, not 50%.
//
// The energy roll and the character die are independent, and both outcome spaces are uniform,
// so multiplying the counts gives an exact combined tally (e.g. 216 rolls x 6 faces = 1296
// equally likely outcomes) with no floating-point rounding.
export function jointOdds(moveOdds, charaOdds) {
  return {
    payable: moveOdds.payable * charaOdds.hits,
    total: moveOdds.total * charaOdds.total
  }
}

// The energy outcomes of a roll after the opponent has made the thrower rethrow `n` dice
// (ほりかえす / ジュエルフラッシュ). The caster sees the roll and the move it is for, and must
// name exactly n dice — the reroll picker won't submit fewer — so for every outcome this picks
// the n that leave the move least likely to be paid, and the result keeps every original
// outcome at equal weight (6^n entries each), ready for payableCount / moveExpectedValue.
//
// Ties go to whichever leaves fewer of the move's own type, which is what per-energy damage
// counts. Being forced to name n also cuts the other way: a die showing one energy rethrows
// to more on average, so a second reroll can rescue a roll that had already failed.
export function forcedRerollRolls(dice, cost, n, ownType = null) {
  const faces = dice.map(die => FACE_KEYS.map(key => faceTypes(die, key)))
  const subsets = []
  const pick = (start, chosen) => {
    if (chosen.length === n) { subsets.push(chosen); return }
    for (let i = start; i < dice.length; i++) pick(i + 1, [...chosen, i])
  }
  pick(0, [])
  if (subsets.length === 0) return enumerateRolls(dice)

  const out = []
  const memo = new Map()
  const walk = (d, shown) => {
    if (d < dice.length) {
      for (let f = 0; f < 6; f++) walk(d + 1, [...shown, f])
      return
    }
    let best = null
    subsets.forEach((subset, si) => {
      // Only the dice left standing matter, so each (subset, kept faces) is worked out once.
      const kept = shown.filter((_, i) => !subset.includes(i))
      const key = `${si}|${kept.join(',')}`
      let option = memo.get(key)
      if (!option) {
        const results = enumerateRolls(subset.map(i => dice[i]))
          .map(rethrown => [...shown.flatMap((f, i) => (subset.includes(i) ? [] : faces[i][f])), ...rethrown])
        const payable = cost && cost.length > 0 ? results.filter(r => canPayCost(r, cost)).length : results.length
        const own = ownType ? results.reduce((sum, r) => sum + r.filter(t => t === ownType).length, 0) : 0
        option = { payable, own, results }
        memo.set(key, option)
      }
      if (!best || option.payable < best.payable || (option.payable === best.payable && option.own < best.own)) best = option
    })
    out.push(...best.results)
  }
  walk(0, [])
  return out
}
