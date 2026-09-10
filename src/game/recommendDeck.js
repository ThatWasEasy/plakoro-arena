// The four moves a player actually brings, chosen for them.
//
// A character's card list is longer than a deck, so something has to pick. Taking the four
// highest expected values is the obvious answer and, left alone, the right one — but it
// answers the question badly in one situation the game creates on purpose: a deck of four
// expensive moves is dead in the water the turn an opponent takes an energy die away. Hence
// the cost floors, which let a player say "at least one move I can still pay for".
//
// What a deck is worth is NOT the sum of its four moves. A move cast last turn is locked out
// of this one, so a player only ever gets through the best two of the four (see turnValue.js)
// — sum the four and the third and fourth cards get credited with value nobody collects, and
// every comparison between decks turns into a comparison of their tails. The rotation's value
// is the objective here, which has an honest consequence worth stating: with no floors set,
// the third and fourth slots are free. Any move can go there without costing the deck a thing,
// and a floor is usually met for nothing.
//
// That freedom is also why the denied cases are a tie-break rather than a weighted term. How
// often a player actually loses a die depends on who they meet, and that number isn't
// knowable here — inventing a weight would bury a guess inside a figure that looks derived.
// So: best rotation at full dice decides it, and among decks that tie there, the one that
// still functions a die down wins. A player who wants more than a tie-break has the floors.
//
// The tie-break applies whether or not a floor is set, and that is not an optimisation to be
// skipped when nothing asks for it. Running it only under a floor made setting a floor do two
// things at once: ファイヤー already carries a two-energy move at rank three, so asking for
// one changed nothing about whether the deck qualified — and yet the fourth slot still moved,
// because the request had quietly switched the tie-break on as well. A toggle has to mean the
// one thing it says, and the denied-dice figures have to be on screen whether or not a floor
// put them there.
import { enumerateRolls } from './energyPayment'
import { ASSUMED_ENEMY_LAST_DAMAGE, suggestedBuild } from './suggestedDice'
import { moveExpectedValue } from './moveExpectedValue'
import { sustainableValue } from './turnValue'

// A normal turn throws 3 energy dice; the first turn of a game throws 2.
export const NORMAL_DICE = 3

// How many moves a player brings to a battle.
export const DECK_SIZE = 4

// Two decks whose rotations land within this many HP of each other are treated as equal, so
// the denied-dice comparison gets to decide. Wide enough that float noise never settles a
// choice, narrow enough that it never overrules a difference a player would notice.
const TIE_HP = 0.05

// Die counts a deck is judged at: a normal turn, and the two restrictions the card pool can
// impose on it. Ordered by how much they matter, which is the order they break ties in.
export const JUDGED_DICE = [NORMAL_DICE, NORMAL_DICE - 1, NORMAL_DICE - 2]

/**
 * Every move a character could bring, valued on the dice a player would build for them.
 *
 * @param {object} character   roster entry, with `moves` as a list of ids
 * @param {object} movesById   every move, keyed by id
 * @param {object} [options]
 * @param {object} [options.tempoValues]  table from buildTempoTable, or null to leave denial
 *                                        effects at zero
 * @param {boolean} [options.countDefensiveValue]  credit damage reduction as HP kept. On by
 *                                        default, matching the tier list: this screen asks
 *                                        what to bring, and a move whose whole point is the
 *                                        reduction is not worth zero to a player choosing it
 * @param {number[]} [options.dieCounts]  which die counts to value each move at. Defaults to
 *                                        a normal turn only — the extra counts cost a full
 *                                        re-evaluation each and are only worth paying for
 *                                        when something downstream compares them.
 * @returns {{build: object, entries: Array}|null} entries sorted best first, each carrying
 *          `ev` (at a normal turn), `evAt` keyed by die count, and the full `result`
 */
export function scoreMoves(character, movesById, options = {}) {
  const {
    tempoValues = null,
    enemyLastDamage = ASSUMED_ENEMY_LAST_DAMAGE,
    countDefensiveValue = true,
    dieCounts = [NORMAL_DICE]
  } = options

  const build = suggestedBuild(character, movesById, NORMAL_DICE)
  if (!build) return null

  // The opponent's dice are the caster's own build: there is no opponent on this screen, and
  // the mirror is what the rest of the model assumes for the same reason (see the
  // NOTE_MIRROR_DICE marker in moveExpectedValue.js).
  const enemyDice = build.dice.slice(0, NORMAL_DICE)
  const rollsFor = {}
  dieCounts.forEach(count => { rollsFor[count] = count > 0 ? enumerateRolls(build.dice.slice(0, count)) : [] })

  const entries = build.moveList.map(mv => {
    const evAt = {}
    let result = null
    dieCounts.forEach(count => {
      // No dice is no cast, not a free one.
      if (count <= 0) { evAt[count] = 0; return }
      const scored = moveExpectedValue(mv, {
        rolls: rollsFor[count], enemyDice, tempoValues, enemyLastDamage, countDefensiveValue
      })
      evAt[count] = scored.ev
      if (count === NORMAL_DICE) result = scored
    })
    return { mv, ev: evAt[NORMAL_DICE] ?? 0, evAt, result }
  })

  entries.sort((a, b) => b.ev - a.ev)
  return { build, entries }
}

// Every way to take `size` of them, in the order a greedy reader would try. Deck sizes are 4
// and move lists top out around eleven, so this is a few hundred combinations — small enough
// that the exact answer is cheaper than justifying an approximate one.
function* combinations(entries, size) {
  const pick = []
  function* walk(start) {
    if (pick.length === size) { yield [...pick]; return }
    // Stop when too few entries are left to finish the deck.
    for (let i = start; i <= entries.length - (size - pick.length); i++) {
      pick.push(entries[i])
      yield* walk(i + 1)
      pick.pop()
    }
  }
  if (size <= entries.length) yield* walk(0)
}

function rotationValues(deck, dieCounts) {
  return dieCounts.map(count => sustainableValue(deck.map(entry => entry.evAt[count] ?? 0)))
}

function better(candidate, incumbent) {
  for (let i = 0; i < candidate.length; i++) {
    const diff = candidate[i] - incumbent[i]
    if (Math.abs(diff) > TIE_HP) return diff > 0
  }
  return false
}

/**
 * The best `size` moves, subject to bringing at least one move at each printed energy cost
 * in `costFloors`.
 *
 * Cost is the number printed on the card, which is what a player counts when they read it.
 * That is deliberately not the same question as "can one die pay for this" — a square socket's
 * dual chip pays two types off one face, so a 2-cost move is sometimes a one-die move. The
 * floor matches the card; the ranking already accounts for real payability, because that is
 * baked into every expected value here.
 *
 * @param {Array} entries          from scoreMoves, valued at every count in `dieCounts`
 * @param {object} [options]
 * @param {number[]} [options.costFloors]  printed costs that must each appear at least once
 * @returns {{deck: Array, unmet: number[]}} `unmet` lists the floors no move could satisfy;
 *          those are dropped rather than failing, so the caller always gets a usable deck
 *          and can say why it isn't what was asked for
 */
export function chooseDeck(entries, options = {}) {
  const { size = DECK_SIZE, costFloors = [], dieCounts = JUDGED_DICE } = options

  // A floor no card can meet is reported, not enforced: ヒトカゲ has no one-energy move at
  // all, and silently returning its best four would leave a player believing the request was
  // honoured.
  const unmet = costFloors.filter(cost => !entries.some(entry => (entry.mv.cost || []).length === cost))
  const floors = costFloors.filter(cost => !unmet.includes(cost))

  const counts = dieCounts.filter(count => entries.every(entry => entry.evAt[count] !== undefined))
  let best = null
  let bestScore = null
  for (const deck of combinations(entries, size)) {
    if (floors.length > 0 && !floors.every(cost => deck.some(entry => (entry.mv.cost || []).length === cost))) continue
    const score = rotationValues(deck, counts)
    if (best === null || better(score, bestScore)) {
      best = deck
      bestScore = score
    }
  }
  // Only reachable when the character has fewer moves than a deck holds, in which case they
  // bring what they have.
  if (best === null) return { deck: entries.slice(0, size), unmet: costFloors }

  return { deck: [...best].sort((a, b) => b.ev - a.ev), unmet }
}

/**
 * scoreMoves and chooseDeck in one call, for a caller that wants the finished recommendation.
 */
export function recommendDeck(character, movesById, options = {}) {
  const { costFloors = [], size = DECK_SIZE, ...scoreOptions } = options
  // scoreMoves builds the evaluation env itself, so anything it doesn't name is dropped
  // silently — every option this function accepts has to be one scoreMoves destructures.
  const scored = scoreMoves(character, movesById, { ...scoreOptions, dieCounts: JUDGED_DICE })
  if (!scored) return null
  const { deck, unmet } = chooseDeck(scored.entries, { size, costFloors, dieCounts: JUDGED_DICE })
  return {
    character,
    build: scored.build,
    entries: scored.entries,
    deck,
    unmet,
    // What the deck is actually worth, and what is left of it a die down — the pair a player
    // is trading between when they set a floor.
    rotation: rotationValues(deck, JUDGED_DICE)
  }
}
