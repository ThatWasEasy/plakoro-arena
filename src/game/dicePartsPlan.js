// Works out what a dice set costs to actually own: which physical parts it needs, what's still
// missing after your existing collection, and the cheapest combination of retail products that
// covers the gap.
//
// The builder lets you assemble any die you like, which quietly assumes you have the parts.
// A player deciding whether to buy another box has the opposite problem — they know what they
// want and need to know what it costs. That's what this answers.
import { FACE_KEYS, CONVEX_TYPES, CONCAVE_TYPES } from './diceParts'
import { PRODUCT_PARTS, isReleased } from '../data/productParts'

export const PART_KINDS = { convex: 'convex', concave: 'concave', single: 'single', dual: 'dual' }

// A dual chip is one physical piece printed with two types, and 火+火 is as real a piece as
// 火+雷 — so the pair is the identity, order-independent.
export function dualKey(a, b) {
  return [a, b].sort().join('+')
}

// Parts needed to build `dice` from nothing. Counts pieces, not faces: two dice that both want
// a 火 convex half need two halves, even though it's "the same" face.
export function requiredParts(dice) {
  const need = { convex: {}, concave: {}, single: {}, dual: {}, convexAny: 0, concaveAny: 0 }
  const bump = (kind, key) => { need[kind][key] = (need[kind][key] || 0) + 1 }
  dice.forEach(die => {
    // A die marked with a dead face needs *a* half from that pool, not a particular one: the
    // face can never show a useful type, so which type is printed on it is irrelevant. Pinning
    // it to a specific type would send the player shopping for a part they don't need — for
    // three pure-fire dice that was two extra boxes of nothing.
    if (die.deadFace === 'convex') { need.convexAny += 1 }
    else if (die.convexType) bump('convex', die.convexType)
    if (die.deadFace === 'concave') { need.concaveAny += 1 }
    else if (die.concaveType) bump('concave', die.concaveType)
    ;(die.singleSlots || []).forEach(s => { if (s && s.type) bump('single', s.type) })
    ;(die.dualSlots || []).forEach(s => {
      if (s && s.types && s.types[0] && s.types[1]) bump('dual', dualKey(s.types[0], s.types[1]))
    })
  })
  return need
}

// Sum of every count in a `{convex,concave,single,dual}` shape — the piece count, for headline
// figures like "this set is 24 pieces".
const GROUPS = ['convex', 'concave', 'single', 'dual']

export function totalPieces(parts) {
  const specific = GROUPS.reduce(
    (sum, k) => sum + Object.values(parts[k] || {}).reduce((a, b) => a + b, 0), 0)
  return specific + (parts.convexAny || 0) + (parts.concaveAny || 0)
}

// What `need` still lacks once `owned` is applied. Both are the same shape; a part you own more
// of than you need simply doesn't appear in the result.
export function shortfall(need, owned) {
  const out = { convex: {}, concave: {}, single: {}, dual: {}, convexAny: 0, concaveAny: 0 }
  const leftover = { convex: 0, concave: 0 }
  GROUPS.forEach(kind => {
    Object.entries(need[kind] || {}).forEach(([key, n]) => {
      const have = (owned && owned[kind] && owned[kind][key]) || 0
      if (n > have) out[kind][key] = n - have
    })
  })
  // Halves owned beyond what the named requirements used are still halves, and a dead face will
  // take any of them — so they're counted against the wildcard before anything is bought.
  ;['convex', 'concave'].forEach(pool => {
    const ownedTotal = Object.values((owned && owned[pool]) || {}).reduce((a, b) => a + b, 0)
    const usedByNamed = Object.entries(need[pool] || {}).reduce(
      (sum, [key, n]) => sum + Math.min(n, ((owned && owned[pool] && owned[pool][key]) || 0)), 0)
    leftover[pool] = Math.max(0, ownedTotal - usedByNamed)
  })
  out.convexAny = Math.max(0, (need.convexAny || 0) - leftover.convex)
  out.concaveAny = Math.max(0, (need.concaveAny || 0) - leftover.concave)
  return out
}

function partsOf(product) {
  return { convex: product.convex, concave: product.concave, single: product.single, dual: product.dual }
}

// How many of `gap` a single copy of this product covers. Used to rank candidates: a box that
// supplies nothing you're short of is never worth buying, however cheap.
function poolTotal(group) {
  return Object.values(group || {}).reduce((a, b) => a + b, 0)
}

function coverage(gap, product) {
  const p = partsOf(product)
  let covered = 0
  GROUPS.forEach(kind => {
    Object.entries(gap[kind] || {}).forEach(([key, n]) => {
      covered += Math.min(n, (p[kind] && p[kind][key]) || 0)
    })
  })
  // Any half from the right pool satisfies a dead face, so the whole pool counts — minus what
  // this box's halves were already credited for against a named requirement.
  ;['convex', 'concave'].forEach(pool => {
    const wildcard = gap[pool + 'Any'] || 0
    if (wildcard <= 0) return
    const namedUse = Object.entries(gap[pool] || {}).reduce(
      (sum, [key, n]) => sum + Math.min(n, (p[pool] && p[pool][key]) || 0), 0)
    covered += Math.min(wildcard, Math.max(0, poolTotal(p[pool]) - namedUse))
  })
  return covered
}

function subtract(gap, product, times = 1) {
  const p = partsOf(product)
  const out = { convex: {}, concave: {}, single: {}, dual: {}, convexAny: 0, concaveAny: 0 }
  GROUPS.forEach(kind => {
    Object.entries(gap[kind] || {}).forEach(([key, n]) => {
      const left = n - ((p[kind] && p[kind][key]) || 0) * times
      if (left > 0) out[kind][key] = left
    })
  })
  ;['convex', 'concave'].forEach(pool => {
    const namedUse = Object.entries(gap[pool] || {}).reduce(
      (sum, [key, n]) => sum + Math.min(n, ((p[pool] && p[pool][key]) || 0) * times), 0)
    const spare = Math.max(0, poolTotal(p[pool]) * times - namedUse)
    out[pool + 'Any'] = Math.max(0, (gap[pool + 'Any'] || 0) - spare)
  })
  return out
}

// Buys whatever closes the most of the gap per yen, repeatedly. Fast, and always finds an answer
// if one exists, but not necessarily the cheapest — a box that covers more pieces now can leave a
// worse remainder than a box that covers fewer.
function greedyPlan(gap, usable, maxBoxes) {
  const picks = new Map()
  let left = gap
  let count = 0
  let cost = 0

  while (totalPieces(left) > 0 && count < maxBoxes) {
    let best = null
    usable.forEach(p => {
      const cov = coverage(left, p)
      if (cov === 0) return
      const perYen = cov / p.jpy
      if (!best || perYen > best.perYen || (perYen === best.perYen && p.jpy < best.product.jpy)) {
        best = { product: p, perYen, cov }
      }
    })
    // Nothing on sale supplies what's left — the remainder is genuinely unobtainable, not
    // merely hard to find, and saying so is more useful than looping until maxBoxes.
    if (!best) break
    picks.set(best.product.key, (picks.get(best.product.key) || 0) + 1)
    count += 1
    cost += best.product.jpy
    left = subtract(left, best.product)
  }
  return { picks, count, cost, left }
}

// Cheapest combination that covers `gap`, searched exhaustively, with the shortest list winning
// ties — so two equally-priced answers resolve to the one that's fewer trips to the shop.
//
// Set cover is NP-hard in general, but this instance is tiny — 16 products, answers of a handful
// of boxes — so an exact search is both affordable and worth it. Branch and bound with the greedy
// result as the opening upper bound; products are only ever added in catalogue order, so each
// combination is reached once rather than once per permutation.
// How lopsided a plan is: the most copies of any one product. Buying three of the same box and
// buying one each of three is the same spend and the same trip, but a player collecting figures
// wants the second — so when asked to spread, this is what gets minimised.
function maxCopies(picks) {
  let m = 0
  picks.forEach(n => { if (n > m) m = n })
  return m
}

function exactPlan(gap, usable, { costCeiling, maxBoxes, preferVariety = false }) {
  let bestCost = costCeiling
  let bestBoxes = Infinity
  let bestSpread = Infinity
  let bestDistinct = 0
  let bestPicks = null
  let nodes = 0
  const NODE_BUDGET = 200000

  // Cost is never traded away: spreading only ever picks between answers that cost the same, so
  // ticking the box can't quietly make the trip more expensive. Within that, fewest repeats wins,
  // then most distinct products, then fewest boxes.
  const better = (cost, depth, spread, distinct) => {
    if (cost !== bestCost) return cost < bestCost
    if (!preferVariety) return depth < bestBoxes
    if (spread !== bestSpread) return spread < bestSpread
    if (distinct !== bestDistinct) return distinct > bestDistinct
    return depth < bestBoxes
  }

  const search = (startIdx, left, picks, cost, depth) => {
    if (nodes++ > NODE_BUDGET) return false
    if (totalPieces(left) === 0) {
      const spread = maxCopies(picks)
      if (better(cost, depth, spread, picks.size)) {
        bestCost = cost; bestBoxes = depth; bestSpread = spread
        bestDistinct = picks.size; bestPicks = new Map(picks)
      }
      return true
    }
    if (depth >= maxBoxes) return true
    for (let i = startIdx; i < usable.length; i++) {
      const p = usable[i]
      // The cheapest box left still can't undercut the best answer found. With variety on, an
      // equal-cost answer may still be better, so equal cost has to stay in the search.
      if (cost + p.jpy > bestCost) continue
      if (coverage(left, p) === 0) continue
      picks.set(p.key, (picks.get(p.key) || 0) + 1)
      const ok = search(i, subtract(left, p), picks, cost + p.jpy, depth + 1)
      const back = picks.get(p.key) - 1
      if (back === 0) picks.delete(p.key); else picks.set(p.key, back)
      if (!ok) return false
    }
    return true
  }

  const finished = search(0, gap, new Map(), 0, 0)
  return { picks: bestPicks, exhausted: finished }
}

// `asOf` gates the catalogue by release date. Recommending a box that isn't in shops yet is
// worse than recommending nothing — the player goes looking and can't buy it — so the default
// plan only ever contains what's on sale today. Pass `includeUnreleased` to see what an upcoming
// product would change; `planWithUpcoming` below pairs the two.
export function planPurchase(gap, { products = PRODUCT_PARTS, maxBoxes = 40, asOf = new Date(), includeUnreleased = false, preferVariety = false } = {}) {
  const usable = products
    .filter(p => p.status === 'confirmed' && (includeUnreleased || isReleased(p, asOf)))
    .sort((a, b) => a.jpy - b.jpy)
  const greedy = greedyPlan(gap, usable, maxBoxes)
  const reachable = totalPieces(greedy.left) === 0

  // The exact search needs a finite ceiling and a depth limit; the greedy answer supplies both.
  // With no reachable greedy result there's nothing to improve on, so don't bother searching.
  let picks = greedy.picks
  let optimal = false
  if (reachable) {
    const exact = exactPlan(gap, usable, {
      costCeiling: greedy.cost,
      // Spreading trades repeats for distinct products, which can need one more box than the
      // tightest packing — so the depth limit has to leave room for that.
      maxBoxes: preferVariety ? Math.min(maxBoxes, greedy.count + 2) : greedy.count,
      preferVariety
    })
    if (exact.picks) picks = exact.picks
    optimal = exact.exhausted
  }

  return {
    boxes: [...picks.entries()]
      .map(([key, qty]) => ({ product: usable.find(p => p.key === key), qty }))
      .sort((a, b) => b.qty - a.qty || a.product.jpy - b.product.jpy),
    totalBoxes: [...picks.values()].reduce((a, b) => a + b, 0),
    // The most copies of any one product — what the spread option minimises, and what the UI
    // needs to say whether ticking it actually changed anything.
    maxCopies: maxCopies(picks),
    // Not shown anywhere — the UI is a parts list, not a price list — but planWithUpcoming needs
    // it to decide whether an unreleased product is actually worth waiting for.
    totalJpy: [...picks.entries()].reduce((sum, [key, qty]) => {
      const p = usable.find(x => x.key === key)
      return sum + (p ? p.jpy * qty : 0)
    }, 0),
    unobtainable: greedy.left,
    complete: reachable,
    // False only when the search hit its node budget, i.e. the answer is the best found rather
    // than the best there is. The UI should say so rather than imply a guarantee it doesn't have.
    optimal
  }
}

// The plan you can act on today, plus — only when it would genuinely be better — the plan that
// becomes possible once an announced product ships, and which products those are.
//
// "Better" means strictly cheaper, not merely different: an upcoming box that costs more is not
// worth waiting for, and offering it as an option would be noise.
export function planWithUpcoming(gap, { products = PRODUCT_PARTS, asOf = new Date(), preferVariety = false } = {}) {
  const now = planPurchase(gap, { products, asOf, preferVariety })
  const upcoming = planPurchase(gap, { products, asOf, preferVariety, includeUnreleased: true })
  const unreleasedUsed = upcoming.boxes
    .map(b => b.product)
    .filter(p => !isReleased(p, asOf))

  const worthWaiting = unreleasedUsed.length > 0 &&
    (!now.complete || upcoming.totalJpy < now.totalJpy)

  return { now, later: worthWaiting ? upcoming : null, waitingFor: worthWaiting ? unreleasedUsed : [] }
}

// Which parts no confirmed product sells at all. A player staring at "you still need 3 of these"
// deserves to know when the answer is "you can't buy that yet" rather than "buy more boxes".
export function unbuyableParts(gap, products = PRODUCT_PARTS, asOf = new Date()) {
  const usable = products.filter(p => p.status === 'confirmed' && isReleased(p, asOf))
  const out = { convex: {}, concave: {}, single: {}, dual: {} }
  GROUPS.forEach(kind => {
    Object.entries(gap[kind] || {}).forEach(([key, n]) => {
      const anywhere = usable.some(p => (partsOf(p)[kind] || {})[key] > 0)
      if (!anywhere) out[kind][key] = n
    })
  })
  return out
}


// The all-one-type die the odds tables reward: every face that can be that type, is.
//
// Only five of the nine types can sit on a convex face and four on a concave one, so one of the
// two fixed faces is always the wrong pool — that face is dead weight no purchase can fix, and
// the planner should say so rather than silently pick a filler.
export function pureTypeDie(type) {
  const isConvex = CONVEX_TYPES.includes(type)
  return {
    // The filler is only here so the die renders; `deadFace` is what the planner reads, and it
    // tells it any half from that pool will do.
    convexType: isConvex ? type : CONVEX_TYPES[0],
    concaveType: isConvex ? CONCAVE_TYPES[0] : type,
    singleSlots: [{ kind: 'single', type }, { kind: 'single', type }],
    dualSlots: [{ kind: 'dual', types: [type, type] }, { kind: 'dual', types: [type, type] }],
    deadFace: isConvex ? 'concave' : 'convex'
  }
}

export { FACE_KEYS }
