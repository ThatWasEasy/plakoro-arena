// Expected value of a move, layered on top of the payability odds in energyPayment.js.
//
// The odds view answers "can I pay for this move?". This answers "what is it worth when I
// do?" — as the HP swing the move produces: damage dealt to the opponent, minus damage it
// costs its own user. A heal is stored as negative self-damage in the data (see the -20 on
// EBW01-025 はねやすめ), so that one subtraction covers healing too.
//
// The effect semantics mirror runEffectQueue in effectQueue.js, but where the queue asks the
// player what a sub-roll actually produced, this takes its expectation instead. The two must
// stay in step: any change to an effect's meaning there needs the matching change here.
//
// Weakness is deliberately excluded. The calculator has no opponent to look up a weakness on,
// and the question it exists to answer — "which of this character's moves is worth casting
// with the dice I've built?" — is not changed by a flat bonus that lands on whichever move
// happens to match the defender's type.
//
// An effect type with no handler is reported through `notes` rather than silently valued at
// zero, so a new card pulled in by `npm run fetch-data` surfaces as unsupported instead of
// quietly skewing the numbers.
import { CHARA_DIE_FACE_COUNT, canPayCost, enumerateRolls, payableCount } from './energyPayment'

// Why a move's value is only part of the story, keyed by effect type so the UI can explain
// each marker it draws.
// `tempo` marks an effect that changes what the players can do rather than their HP. Left
// to itself it is worth zero here, and the marker distinguishes that deliberate zero from an
// effect this model doesn't recognise at all. Given a table from tempoValue.js it is priced
// instead — see `tempoWorth`. Either way a caller with the move's card already on screen has
// nothing to gain by surfacing the marker; the card says what the effect does.
export const NOTE_TEMPO = 'tempo'             // changes what can be done, not HP directly
export const NOTE_DEFENSIVE = 'defensive'     // damage reduction, credited as HP on request
export const NOTE_NEEDS_HP = 'needsHp'        // conditional on the caster's remaining HP
export const NOTE_NEEDS_PREV = 'needsPrev'    // conditional on what happened last turn
export const NOTE_MIRROR_DICE = 'mirrorDice'  // valued by assuming the opponent's dice match ours
export const NOTE_UNKNOWN = 'unknown'         // depends on the opponent's card; unknowable here
export const NOTE_UNSUPPORTED = 'unsupported' // no handler — data has outgrown this module

// Effects that replace the single character-die roll with several of their own ("このワザは
// キャラコロを合計2回振る"). The die isn't rolled once to decide whether the effect fires; the
// effect *is* the rolls, so its branch is unconditional and no "die missed" branch exists.
const MULTI_ROLL_CHARA = /^DAMAGE_EXTRA_(\d+)CHARADICE$/

function faceCountOf(orientationList) {
  return String(orientationList).split(',').map(s => s.trim()).filter(s => s !== '').length
}

function addNote(state, type, kind) {
  if (!state.notes.has(type)) state.notes.set(type, kind)
}

/**
 * What one dice- or move-denial effect is worth to whoever casts it, read out of a table
 * built by buildTempoTable. Interpreting effect types is this module's job, which is why the
 * lookup lives here rather than next to the table — it keeps the dependency one-way.
 *
 * Anything the table doesn't cover is worth nothing, damage effects included: those are
 * already counted as damage and must not be paid for twice.
 */
export function tempoWorth(type, value, table) {
  if (!table) return 0
  switch (type) {
    case 'MOD_DICE_ENEMY':
      return value <= -2 ? table.denyDice2 : value <= -1 ? table.denyDice1 : 0
    case 'MOD_DICE-CHARADICE_ENEMY':
      return table.denyDice2AndChara
    case 'MOD_CHARADICE_ENEMY':
      return table.denyCharaDie
    case 'MOD_NULLIFY_TAKEN':
      return table.nullifyDamage
    case 'SPECIAL_BIND_WAZA':
      return table.bindMove
    case 'MOD_DICE_STEAL':
      return table.denyDice1 + table.gainDice1
    // The only one that can come out negative: a few moves cost the caster their own dice.
    case 'MOD_DICE_SELF':
      if (value >= 2) return table.gainDice2
      if (value >= 1) return table.gainDice1
      if (value <= -2) return -table.denyDice2
      if (value <= -1) return -table.denyDice1
      return 0
    default:
      return 0
  }
}

function addTempo(state, type, value, env) {
  addNote(state, type, NOTE_TEMPO)
  state.tempo += tempoWorth(type, value, env.tempoValues)
}

// Damage reduction is the one non-damage effect that trades in the same currency as the rest
// of the model — 20 damage not taken is 20 HP kept — but only if the opponent was going to
// land that much anyway. Counting it is therefore the caller's call, and it's only worth
// noting when it is counted: the card already states the reduction, so the fact worth adding
// is that the figure includes it.
function addDefensive(state, value, env, type) {
  if (!env.countDefensiveValue) return
  addNote(state, type, NOTE_DEFENSIVE)
  state.defensive += Math.abs(value)
}

function applyEffect(eff, state, env) {
  const { type, value } = eff

  const multiRoll = MULTI_ROLL_CHARA.exec(type)
  if (multiRoll) {
    const rolls = parseInt(multiRoll[1], 10)
    state.damage += rolls * (env.charaHits / CHARA_DIE_FACE_COUNT) * value
    return
  }

  // "+value, then roll again, repeating until it misses." Getting here already counts as the
  // first success, so the number of successes is geometric on 1: E[n] = 1 / (1 - p).
  if (type === 'DAMAGE_EXTRA_CHARADICE_REPEAT') {
    const p = env.charaHits / CHARA_DIE_FACE_COUNT
    state.damage += p < 1 ? value / (1 - p) : Infinity
    return
  }

  const combo3 = /^DAMAGE_EXTRA_CHARADICE_3COMBO_ENEMY_(.+)$/.exec(type)
  if (combo3) {
    state.damage += 3 * (faceCountOf(combo3[1]) / CHARA_DIE_FACE_COUNT) * value
    return
  }

  const enemyChara = /^DAMAGE_EXTRA_CHARADICE_ENEMY_(.+)$/.exec(type)
  if (enemyChara) {
    state.damage += (faceCountOf(enemyChara[1]) / CHARA_DIE_FACE_COUNT) * value
    return
  }

  const hpLow = /^(DAMAGE_EXTRA|MOD_REDUCE_TAKEN)_(\d+)HP_LOW$/.exec(type)
  if (hpLow) {
    if (env.selfHp === null) {
      addNote(state, type, NOTE_NEEDS_HP)
      return
    }
    if (env.selfHp > parseInt(hpLow[2], 10)) return
    if (hpLow[1] === 'DAMAGE_EXTRA') state.damage += value
    else addDefensive(state, value, env, type)
    return
  }

  // Conditions on the previous turn. The premise is the caller's to set, but the figure is
  // only true under it either way, so it's always flagged.
  if (type === 'DAMAGE_EXTRA_DICE_MISS_ENEMY') {
    addNote(state, type, NOTE_NEEDS_PREV)
    if (env.prev.enemyMoveFailed) state.damage += value
    return
  }
  if (type === 'DAMAGE_EXTRA_DICE_MISS_SELF') {
    addNote(state, type, NOTE_NEEDS_PREV)
    if (env.prev.selfMoveFailed) state.damage += value
    return
  }
  const successSelf = /^(DAMAGE_EXTRA|DAMAGE_SELF)_DICE_SUCCESS_SELF_(.+)$/.exec(type)
  if (successSelf) {
    addNote(state, type, NOTE_NEEDS_PREV)
    if (env.prev.prereqMoveSucceeded) {
      if (successSelf[1] === 'DAMAGE_EXTRA') state.damage += value
      else state.self += value
    }
    return
  }

  // Pinning a character die to a chosen face isn't in the table, so it stays a known zero.
  if (/^FIX_CHARADICE/.test(type)) {
    addTempo(state, type, value, env)
    return
  }

  switch (type) {
    case 'DAMAGE_EXTRA':
      state.damage += value
      break
    case 'DAMAGE_SELF':
      state.self += value
      break
    case 'DAMAGE_MULTIPLY':
      state.damage *= value
      break
    // The energy that paid for the move is the same energy this counts, so the figure is the
    // mean over the rolls that could pay — not over all rolls.
    case 'DAMAGE_EXTRA_ENE':
      state.damage += env.payingTypeMean() * value
      break
    case 'DAMAGE_BY_ENEMY_3DICE': {
      const mean = env.enemyDiceMean()
      if (mean === null) addNote(state, type, NOTE_UNKNOWN)
      else {
        addNote(state, type, NOTE_MIRROR_DICE)
        state.damage += mean * value
      }
      break
    }
    // Copies the number printed on whatever the opponent last cast, which lives on a card
    // this view can't see — so it's worth nothing until the caller states what that number
    // was. Assignment, not addition: the copy replaces the move's own printed damage (which
    // is 0 on the one move that does this) rather than adding to it, matching
    // computeDisplayDamage. Anything the copied move's own character die would have done is
    // explicitly not copied, so only the printed figure carries over.
    case 'DAMAGE_COPY_LAST':
      if (env.enemyLastDamage === null) addNote(state, type, NOTE_UNKNOWN)
      else state.damage = env.enemyLastDamage * value
      break
    // Recasts the whole move on a hit; resolved as a renewal equation by the caller, since the
    // repeat re-rolls energy as well as the character die.
    case 'SPECIAL_REPEAT':
      state.repeats = true
      break
    case 'MOD_REDUCE_TAKEN':
      addDefensive(state, value, env, type)
      break
    // Everything that takes something away from the opponent's next turn, or hands something
    // to the caster's own: worth nothing without a table, priced against the roster with one.
    case 'MOD_NULLIFY_TAKEN':
    case 'MOD_DICE_SELF':
    case 'MOD_DICE_ENEMY':
    case 'MOD_DICE_STEAL':
    case 'MOD_CHARADICE_ENEMY':
    case 'MOD_DICE-CHARADICE_ENEMY':
    case 'SPECIAL_BIND_WAZA':
      addTempo(state, type, value, env)
      break
    // Weakness is out of the model entirely, so suppressing it is already the default.
    case 'SPECIAL_IGNORE_WEAKNESS':
      break
    default:
      addNote(state, type, NOTE_UNSUPPORTED)
  }
}

// One outcome of the character die: the move's own effect plus whichever character-die entry
// (if any) that face belongs to, resolved in the order resolveTurn queues them.
function resolveBranch(mv, ce, env) {
  const state = { damage: mv.baseDamage, self: 0, defensive: 0, tempo: 0, repeats: false, notes: new Map() }
  if (mv.effectType) applyEffect({ type: mv.effectType, value: mv.effectValue }, state, env)
  if (ce && ce.type) applyEffect({ type: ce.type, value: ce.value }, state, env)
  return state
}

// The character die's 6 faces split cleanly between a move's effect entries — every printed
// move keeps their orientation lists disjoint — so each entry is one branch and whatever
// faces are left over are the branch where nothing fires.
//
// `hits` is how many faces the entry itself covers, which is what its own odds are built
// from; `weight` is how much of the move's outcome the branch accounts for. They differ for
// a multi-roll effect, which owns the die outright: there is no face on which the move
// resolves without it, so its branch is unconditional and no miss branch exists.
function buildBranches(mv, charaDiceInPlay) {
  if (!charaDiceInPlay || mv.chara.length === 0) {
    return [{ ce: null, hits: 0, weight: 1 }]
  }
  if (mv.chara.some(ce => MULTI_ROLL_CHARA.test(ce.type))) {
    return mv.chara.map(ce => ({ ce, hits: ce.orientations.length, weight: 1 }))
  }
  const branches = []
  let claimed = 0
  mv.chara.forEach(ce => {
    const hits = ce.orientations.length
    claimed += hits
    branches.push({ ce, hits, weight: hits / CHARA_DIE_FACE_COUNT })
  })
  const missed = CHARA_DIE_FACE_COUNT - claimed
  if (missed > 0) branches.push({ ce: null, hits: 0, weight: missed / CHARA_DIE_FACE_COUNT })
  return branches
}

// Mean count of `type` among the rolls that can actually pay `cost` — the conditional the
// "×N energy of this type" effects need, since the move only resolves when it was paid for.
function conditionalTypeMean(rolls, cost, type) {
  let matched = 0
  let total = 0
  rolls.forEach(roll => {
    if (cost.length > 0 && !canPayCost(roll, cost)) return
    total += 1
    roll.forEach(t => {
      if (t === type) matched += 1
    })
  })
  return total > 0 ? matched / total : 0
}

// Mean size of the largest single-type pile from one throw of the given dice — what
// "一番多く出たタイプのエネルギーの数" resolves to.
export function largestTypePileMean(dice) {
  const outcomes = enumerateRolls(dice)
  if (outcomes.length === 0) return 0
  let sum = 0
  outcomes.forEach(roll => {
    const counts = new Map()
    let largest = 0
    roll.forEach(t => {
      const next = (counts.get(t) || 0) + 1
      counts.set(t, next)
      if (next > largest) largest = next
    })
    sum += largest
  })
  return sum / outcomes.length
}

/**
 * Expected HP swing from casting `mv` with a given dice build.
 *
 * @param {object} mv          a move from useCharacterData
 * @param {object} options
 * @param {Array}  options.rolls   every energy outcome of the build, from enumerateRolls
 * @param {Array}  [options.enemyDice]  dice to assume the opponent throws, for the one move
 *                                      that makes them roll; omitted means "don't guess"
 * @param {boolean} [options.charaDiceInPlay]  false when the character die is blocked
 * @param {number|null} [options.selfHp]  remaining HP, or null to leave HP conditions unmet
 * @param {number|null} [options.enemyLastDamage]  printed damage of the opponent's last
 *                                                  move, for the one move that copies it;
 *                                                  null leaves it uncounted
 * @param {object} [options.prev]  which previous-turn premises hold
 * @param {boolean} [options.countDefensiveValue]  credit damage reduction as HP kept
 */
export function moveExpectedValue(mv, options) {
  const {
    rolls,
    enemyDice = null,
    charaDiceInPlay = true,
    selfHp = null,
    enemyLastDamage = null,
    prev = {},
    countDefensiveValue = false,
    tempoValues = null
  } = options

  const odds = payableCount(rolls, mv.cost)
  const pSuccess = odds.total > 0 ? odds.payable / odds.total : 0

  // Both of these cost a pass of their own and only one printed move each needs them, so
  // they stay lazy and memoised rather than being computed for every move in the list.
  let payingTypeMeanCache = null
  let enemyDiceMeanCache = null
  const env = {
    charaHits: CHARA_DIE_FACE_COUNT,
    selfHp,
    enemyLastDamage,
    countDefensiveValue,
    tempoValues,
    prev: {
      enemyMoveFailed: false,
      selfMoveFailed: false,
      prereqMoveSucceeded: false,
      ...prev
    },
    payingTypeMean: () => {
      if (payingTypeMeanCache === null) {
        payingTypeMeanCache = conditionalTypeMean(rolls, mv.cost, mv.type)
      }
      return payingTypeMeanCache
    },
    enemyDiceMean: () => {
      if (!enemyDice || enemyDice.length === 0) return null
      if (enemyDiceMeanCache === null) enemyDiceMeanCache = largestTypePileMean(enemyDice)
      return enemyDiceMeanCache
    }
  }

  const notes = new Map()
  let repeatFaces = 0
  let damageOnHit = 0
  let selfOnHit = 0
  let defensiveOnHit = 0
  let tempoOnHit = 0

  const branches = buildBranches(mv, charaDiceInPlay).map(branch => {
    const state = resolveBranch(mv, branch.ce, { ...env, charaHits: branch.hits })
    // Mirrors proceedToAnimateWithCtx: a move can't heal the opponent, so damage floors at 0.
    const damage = Math.max(state.damage, 0)
    damageOnHit += branch.weight * damage
    selfOnHit += branch.weight * state.self
    defensiveOnHit += branch.weight * state.defensive
    tempoOnHit += branch.weight * state.tempo
    if (state.repeats) repeatFaces += branch.hits
    state.notes.forEach((kind, type) => addNote({ notes }, type, kind))
    return {
      orientations: branch.ce ? branch.ce.orientations : null,
      probability: branch.weight,
      damage,
      self: state.self,
      net: damage - state.self + state.defensive + state.tempo
    }
  })

  let evDamage = pSuccess * damageOnHit
  let evSelf = pSuccess * selfOnHit
  let evDefensive = pSuccess * defensiveOnHit
  let evTempo = pSuccess * tempoOnHit

  // What a successful cast deals before the character die contributes anything: the printed
  // damage plus the move's own effect. It is worked out directly rather than read off the
  // "die missed" branch, because a move whose effect entries cover all six faces — or which
  // throws the die several times of its own accord — has no such branch to read.
  const baseline = resolveBranch(mv, null, { ...env, charaHits: 0 })
  const evDamageBase = pSuccess * Math.max(baseline.damage, 0)

  // A repeat is a fresh cast of the same move — new energy roll, new character die — so the
  // total is the fixed point of "value of one cast, plus another whole go at probability q".
  if (repeatFaces > 0) {
    const q = pSuccess * (repeatFaces / CHARA_DIE_FACE_COUNT)
    if (q < 1) {
      const casts = 1 / (1 - q)
      evDamage *= casts
      evSelf *= casts
      evDefensive *= casts
      evTempo *= casts
    }
  }

  // The five figures add up to `ev` exactly (evSelf counts against it), so a caller can lay
  // them out as a decomposition of the headline rather than as unrelated statistics. Extra
  // casts won by a repeat effect land in the character-die share, which is where they came
  // from — the baseline is deliberately left unscaled by the repeat factor.
  return {
    odds,
    pSuccess,
    evDamage,
    evDamageBase,
    evDamageChara: evDamage - evDamageBase,
    evSelf,
    evDefensive,
    evTempo,
    ev: evDamage - evSelf + evDefensive + evTempo,
    branches,
    notes: [...notes].map(([type, kind]) => ({ type, kind }))
  }
}
