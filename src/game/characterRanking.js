// Every character measured against the others, each on the dice a player would build for
// them (see suggestedDice.js) — comparing a roster on one shared build mostly reports whose
// type that build happened to be.
//
// The hard part is the eight printed moves that only pay out under a condition. Scoring them
// as if the condition never holds understates a character built around one; scoring them as
// if it always holds is worse, since three of ルカリオ's four best moves want it to be losing
// and it would ride that to the top of the table. What separates the two cases is who
// decides:
//
//   - Conditions the caster elects (「前の自分の番、どくガスが成功していたなら」) cost a turn
//     to arrange, so the move is priced as the whole sequence: the enabler's own turn averaged
//     in with the payoff. That is not a penalty invented to be fair — it is what the sequence
//     is worth, and for the one printed combo it comes out below simply attacking twice, so
//     the character gains nothing. The alternative is taken whenever it wins.
//   - Conditions nobody elects (being under 40 HP, the dice having failed last turn) are
//     weighted by how often they actually hold, at frequencies derived from the roster rather
//     than chosen.
//
// Two metrics are offered because they answer different questions. The top-N average asks
// how strong a character's best moves are; the per-turn value asks what an average turn is
// worth, splitting the game into HP bands and taking the best move available in each. The
// second handles conditional moves natively — a low-HP finisher counts fully in the band
// where it can be cast and not at all elsewhere — while the first has to weight them.
//
// A third framing, tempting and wrong, is to score a conditional move as "its value when the
// condition holds, else whatever I'd have cast instead". That reads as the obvious reading of
// "I only cast it when it lands", but it charges the fallback move's value to the conditional
// move's name: カイロス's ぎゃくじょうスイング scores 27.4 that way, higher than the 24.0 it is
// worth even when the condition does hold, and every character with a conditional move gets
// its best move counted twice over. It measures what a turn is worth, not what a move is
// worth — which is the per-turn metric's job, done properly, below.
import { enumerateRolls } from './energyPayment'
import { moveExpectedValue } from './moveExpectedValue'
import { ASSUMED_ENEMY_LAST_DAMAGE, suggestedBuild } from './suggestedDice'

export const DEFAULT_TOP_N = 3
export const METRIC_TOP_N = 'topN'
export const METRIC_PER_TURN = 'perTurn'

// The HP thresholds the printed moves actually key off, high to low. Bands are the gaps
// between them, plus everything above the highest.
const HP_THRESHOLDS = [80, 40]

function premiseOf(mv) {
  const types = [mv.effectType, ...mv.chara.map(ce => ce.type)]
  for (const type of types) {
    const hp = /_(\d+)HP_LOW$/.exec(type)
    if (hp) return { kind: 'hp', threshold: parseInt(hp[1], 10) }
    if (type === 'DAMAGE_EXTRA_DICE_MISS_ENEMY' || type === 'DAMAGE_EXTRA_DICE_MISS_SELF') {
      return { kind: 'miss' }
    }
    const combo = /_DICE_SUCCESS_SELF_(.+)$/.exec(type)
    if (combo) return { kind: 'combo', enablerId: combo[1] }
  }
  return null
}

/**
 * How often each unelected condition holds, worked out from the roster rather than assumed.
 *
 * A character starting at full HP takes about `maxHp / damagePerTurn` hits before falling,
 * so counting the turns spent at or below a threshold across every character gives its
 * frequency directly. A dice failure is just the move a player committed to going unpaid,
 * which is one minus the success rate of the move they'd have picked.
 */
function premiseFrequencies(entries) {
  const damagePerTurn = entries.reduce((sum, e) => sum + e.bestPlain, 0) / entries.length
  const successRate = entries.reduce((sum, e) => sum + e.bestPlainSuccess, 0) / entries.length

  const atOrBelow = {}
  HP_THRESHOLDS.forEach(threshold => { atOrBelow[threshold] = 0 })
  let turns = 0
  if (damagePerTurn > 0) {
    entries.forEach(({ character }) => {
      for (let hp = character.hp; hp > 0; hp -= damagePerTurn) {
        turns += 1
        HP_THRESHOLDS.forEach(threshold => { if (hp <= threshold) atOrBelow[threshold] += 1 })
      }
    })
  }
  const hpAtOrBelow = {}
  HP_THRESHOLDS.forEach(threshold => {
    hpAtOrBelow[threshold] = turns > 0 ? atOrBelow[threshold] / turns : 0
  })
  return { hpAtOrBelow, diceMissed: 1 - successRate, damagePerTurn }
}

// Every HP band a game passes through, with how much of the game is spent in it. Ordered
// from healthy to nearly dead so the detail view reads as the game does.
function hpBands(freq) {
  const bands = []
  let covered = 0
  const ascending = [...HP_THRESHOLDS].sort((a, b) => a - b)
  const cumulative = ascending.map(threshold => freq.hpAtOrBelow[threshold])
  bands.push({ hp: null, above: true, weight: Math.max(0, 1 - cumulative[cumulative.length - 1]) })
  for (let i = ascending.length - 1; i >= 0; i--) {
    const below = i > 0 ? cumulative[i - 1] : 0
    bands.push({ hp: ascending[i], weight: Math.max(0, cumulative[i] - below) })
    covered += 1
  }
  return bands.filter(band => band.weight > 0 || covered === 0)
}

export function rankCharacters(characters, movesById, options = {}) {
  const {
    topN = DEFAULT_TOP_N,
    tempoValues = null,
    metric = METRIC_TOP_N,
    // Damage reduction is HP kept, and this table is asking how strong a character is, so
    // it counts — and it has to, or a move whose whole condition guards a reduction would
    // score the same met as unmet.
    countDefensiveValue = true,
    enemyLastDamage = ASSUMED_ENEMY_LAST_DAMAGE
  } = options

  // First pass: each character's build, and their best move ignoring every condition. That
  // best move is both the yardstick a combo has to beat and the input the frequencies are
  // derived from, so it has to exist before anything else can be scored.
  const entries = characters
    .map(character => {
      const build = suggestedBuild(character, movesById)
      if (!build) return null
      const rolls = enumerateRolls(build.dice)
      const base = { rolls, enemyDice: build.dice, tempoValues, enemyLastDamage, countDefensiveValue }
      const plainResults = new Map()
      build.moveList.forEach(mv => plainResults.set(mv.id, moveExpectedValue(mv, base)))
      const unconditional = build.moveList.filter(mv => premiseOf(mv) === null)
      const yardstick = (unconditional.length > 0 ? unconditional : build.moveList)
        .map(mv => plainResults.get(mv.id))
        .sort((a, b) => b.ev - a.ev)[0]
      return {
        character, build, base, plainResults,
        bestPlain: yardstick ? yardstick.ev : 0,
        bestPlainSuccess: yardstick ? yardstick.pSuccess : 1
      }
    })
    .filter(Boolean)

  if (entries.length === 0) return []
  const freq = premiseFrequencies(entries)
  const bands = hpBands(freq)

  return entries
    .map(entry => {
      const { character, build, base, plainResults, bestPlain } = entry

      // What a move is worth with a given HP in hand, and with the conditions nobody elects
      // already averaged in at their own frequency.
      function valueAt(mv, selfHp) {
        const plain = plainResults.get(mv.id).ev
        const premise = premiseOf(mv)
        if (!premise) return plain

        if (premise.kind === 'combo') {
          const enabler = build.moveList.find(m => m.id === premise.enablerId)
          if (!enabler) return plain
          const enablerResult = plainResults.get(enabler.id)
          const met = moveExpectedValue(mv, { ...base, selfHp, prev: { prereqMoveSucceeded: true } }).ev
          // The enabler can still fail to be paid for, in which case the turn bought nothing.
          const payoff = enablerResult.pSuccess * met + (1 - enablerResult.pSuccess) * plain
          return Math.max(plain, (enablerResult.ev + payoff) / 2)
        }

        if (premise.kind === 'hp') {
          const met = moveExpectedValue(mv, { ...base, selfHp: premise.threshold }).ev
          // In a stated HP band the condition is simply true or false; with no band in mind
          // it falls back to how much of a game is spent under the threshold.
          const holds = selfHp !== null ? (selfHp <= premise.threshold ? 1 : 0) : freq.hpAtOrBelow[premise.threshold]
          return plain + holds * (met - plain)
        }

        const met = moveExpectedValue(mv, { ...base, selfHp, prev: { enemyMoveFailed: true, selfMoveFailed: true } }).ev
        return plain + freq.diceMissed * (met - plain)
      }

      if (metric === METRIC_PER_TURN) {
        // A turn is worth the best move available in whatever state the game is in, so the
        // maximum is taken inside each band and the bands are then weighted.
        const detail = bands.map(band => {
          // The healthy band is "above every threshold", which for this character means its
          // own starting HP — enough for each condition to read as false rather than unknown.
          const bandHp = band.above ? character.hp : band.hp
          const scored = build.moveList
            .map(mv => ({ mv, ev: valueAt(mv, bandHp) }))
            .sort((a, b) => b.ev - a.ev)
          return { ...band, hp: bandHp, above: !!band.above, best: scored[0] }
        })
        return {
          character,
          mainType: build.mainType,
          secondaryType: build.secondaryType,
          metric,
          bands: detail,
          top: detail.map(band => ({ mv: band.best.mv, ev: band.best.ev, weight: band.weight, hp: band.hp, above: band.above })),
          moveCount: build.moveList.length,
          average: detail.reduce((sum, band) => sum + band.weight * band.best.ev, 0)
        }
      }

      const scored = build.moveList
        .map(mv => ({ mv, ev: valueAt(mv, null) }))
        .sort((a, b) => b.ev - a.ev)
      const top = scored.slice(0, topN)
      if (top.length === 0) return null
      return {
        character,
        mainType: build.mainType,
        secondaryType: build.secondaryType,
        metric,
        top,
        moveCount: scored.length,
        yardstick: bestPlain,
        // Divided by however many moves the character actually has, so a short roster entry
        // isn't flattered by a full-length divisor.
        average: top.reduce((sum, entry2) => sum + entry2.ev, 0) / top.length
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.average - a.average)
}
