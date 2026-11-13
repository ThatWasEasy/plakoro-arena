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
export const NOTE_HEAL = 'heal'               // HP regained, capped by how much is missing

// Effects that replace the single character-die roll with several of their own ("このワザは
// キャラコロを合計2回振る"). The die isn't rolled once to decide whether the effect fires; the
// effect *is* the rolls, so its branch is unconditional and no "die missed" branch exists.
const MULTI_ROLL_CHARA = /^DAMAGE_EXTRA_(\d+)CHARADICE$/

// `DAMAGE_EXTRA_ENE_<energy>` — counts a named energy rather than the move's own type.
const ENE_TYPED = /^DAMAGE_EXTRA_ENE_(.+)$/

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
export function tempoWorth(type, value, table, selfTable = null) {
  if (!table) return 0
  // 針對自己的那幾種效果用自己那張表 —— 少一顆骰對「我」值多少是算得出來的確切數字，
  // 不必拿「對最強五隻的平均」來代。沒給就退回對手表，行為跟以前一樣。
  const own = selfTable || table
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
    // Choosing the opponent's move outright is bindMove's stronger sibling: banning their
    // best leaves them their second, picking for them leaves them their worst. Priced at the
    // same measured gap for now rather than inventing a multiplier — it is an understatement,
    // and an understatement with a tempo marker beside it beats a guess.
    case 'SPECIAL_PICK_ENEMY_WAZA':
      return table.bindMove
    // 逼對手重擲不是扣掉骰子：骰子還在，純屬骰重擲 5/6 仍有主屬。實算見 forcedRerollRolls；
    // 舊表沒有這欄時才退回「扣掉骰子」的粗估（它會高估，重擲兩顆約六倍）。
    case 'REROLL_DICE_ENEMY': {
      const measured = value >= 2 ? table.forcedReroll2 : table.forcedReroll1
      if (typeof measured === 'number') return measured
      return value >= 2 ? table.denyDice2 : table.denyDice1
    }
    // 自己的角色骰多看一次。這不是「骰子被拿走」的反面 —— 被拿走你得換招，重擲是照樣打
    // 同一招，只是命中率從 k/6 拉到 1-(1-k/6)^(r+1)。所以它的價錢只能從「自己最強的那幾招
    // 在命中率提高後多賺多少」實算，selfDiceValues 會量出來。沒量到就退回舊的粗估。
    case 'REROLL_CHARADICE_SELF': {
      const measured = value >= 2 ? own.rerollCharaDie2 : own.rerollCharaDie1
      if (typeof measured === 'number') return measured
      return value >= 2 ? own.denyCharaDie : own.denyCharaDie / 2
    }
    case 'MOD_DICE_STEAL':
      return table.denyDice1 + table.gainDice1
    // The only one that can come out negative: a few moves cost the caster their own dice.
    case 'MOD_DICE_SELF':
      if (value >= 2) return own.gainDice2
      if (value >= 1) return own.gainDice1
      if (value <= -2) return -own.denyDice2
      if (value <= -1) return -own.denyDice1
      return 0
    default:
      return 0
  }
}

function addTempo(state, type, value, env) {
  addNote(state, type, NOTE_TEMPO)
  state.tempo += tempoWorth(type, value, env.tempoValues, env.selfTempoValues)
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

// Healing is HP in the same currency as `defensive` — 20 HP back is worth as much as 20 not
// taken — but with a ceiling the other effects do not have: you cannot heal past full, so a
// move that heals 50 is worth 50 to someone at 70/120 and nothing at all to someone untouched.
//
// `selfHp` is what the premises panel already collects. When it is set the cap is real
// arithmetic; when it is not, the figure is the printed number and the note says so, which is
// the same bargain MOD_REDUCE_TAKEN strikes. Either way it is flagged, because "worth 50" is
// only true of a player who is actually 50 down.
function addHeal(state, amount, env, type) {
  addNote(state, type, NOTE_HEAL)
  if (env.selfHp === null || env.maxHp === null) {
    state.heal += amount
    return
  }
  // 同一次施放裡的多段回血共用同一個缺口 —— 上半段先回掉的，角色骰那段就回不到了。
  // 各自獨立跟滿血算上限的話，生蛋（回 20 ＋ 角色骰一面回滿）在 100 血只缺 20，
  // 卻會算出 20 + 20 的回血價值，比它最多能回的還多。
  const headroom = Math.max(0, env.maxHp - env.selfHp - state.heal)
  state.heal += Math.min(Math.max(0, amount), headroom)
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

  // チルタリス's shield: the damage is cancelled only if the attacker's character die happens
  // to land on one of these faces. That probability is knowable — it is faces/6 — but what it
  // saves is not: the calculator has no opponent, so it cannot know what they would have hit
  // for. Same unknowable shape as MOD_NULLIFY_TAKEN, which is also left to the tempo table.
  if (/^MOD_NULLIFY_TAKEN_IF_ENEMY_CHARADICE_/.test(type)) {
    addTempo(state, type, value, env)
    return
  }

  // A shield with a ceiling: worth the hit it blocks, but only against a hit small enough to
  // be blocked. The calculator has no opponent to ask, so it credits the ceiling — the most
  // it can ever be worth — under the same opt-in as any other damage reduction, and the
  // `defensive` marker says the figure includes it.
  if (type === 'NULLIFY_TAKEN_LE') {
    addDefensive(state, value, env, type)
    return
  }

  // Conditions on the previous turn. The premise is the caller's to set, but the figure is
  // only true under it either way, so it's always flagged.
  if (type === 'DAMAGE_EXTRA_IF_UNHURT') {
    addNote(state, type, NOTE_NEEDS_PREV)
    if (env.prev.selfUnhurt) state.damage += value
    return
  }

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

  // Counts a named energy rather than the move's own type — see the DAMAGE_EXTRA_ENE case.
  const eneTyped = ENE_TYPED.exec(type)
  if (eneTyped) {
    state.damage += env.payingTypeMean(eneTyped[1]) * value
    return
  }

  // Pinning a character die to a chosen face isn't in the table, so it stays a known zero.
  if (/^FIX_CHARADICE/.test(type)) {
    addTempo(state, type, value, env)
    return
  }

  // Effects that change what the players can do rather than anyone's HP. Priced from the
  // tempo table when the caller supplies one, and a declared zero with a marker when not —
  // see NOTE_TEMPO. Swapping chips is in the list because it changes a future roll, even
  // though no table entry measures it: the marker is the honest answer there.
  if (type === 'SPECIAL_PICK_ENEMY_WAZA' || type === 'REROLL_DICE_ENEMY' ||
      type === 'REROLL_CHARADICE_SELF' || type === 'SPECIAL_SWAP_CHIP') {
    addTempo(state, type, value, env)
    return
  }

  // Conditional on the opponent's species type, which this calculator has no opponent to look
  // up — same unknowable shape as DAMAGE_BY_ENEMY_3DICE above, just keyed by type instead of a
  // dice mean.
  if (/^DAMAGE_EXTRA_VS_TYPE_/.test(type)) {
    addNote(state, type, NOTE_UNKNOWN)
    return
  }

  switch (type) {
    case 'DAMAGE_EXTRA':
      state.damage += value
      break
    case 'DAMAGE_SELF':
      state.self += value
      break
    case 'HEAL_SELF':
      addHeal(state, value, env, type)
      break
    // "Heal fully" — worth exactly the damage already taken, so it is the one heal whose
    // value is zero at full HP and large at death's door. Unknowable without selfHp, and
    // guessing a number there would be worse than saying so.
    case 'HEAL_SELF_FULL':
      if (env.selfHp === null || env.maxHp === null) addNote(state, type, NOTE_NEEDS_HP)
      else addHeal(state, env.maxHp - env.selfHp, env, type)
      break
    case 'DAMAGE_MULTIPLY':
      state.damage *= value
      break
    // The mean is taken over the rolls that could pay for the move, not over all rolls: a roll
    // that cannot cast it contributes nothing either way.
    //
    // Which energy gets counted is NOT the move's own type. It was on every card until
    // EBW02-049 ドラゴンバースト, a Fire-cost Dragon move that counts Lightning — so the type
    // is named in the effect (`DAMAGE_EXTRA_ENE_かみなり`) and read from there. The bare form
    // still means "the move's own type", which is what the upstream rows in generated/ carry
    // and what fetch-data will keep writing.
    case 'DAMAGE_EXTRA_ENE':
      state.damage += env.payingTypeMean(env.moveType) * value
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
  const state = { damage: mv.baseDamage, self: 0, defensive: 0, heal: 0, tempo: 0, repeats: false, notes: new Map() }
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
function buildBranches(mv, charaDiceInPlay, charaDieFace) {
  if (!charaDiceInPlay || mv.chara.length === 0) {
    return [{ ce: null, hits: 0, weight: 1 }]
  }
  // 骰面被固定住時這顆骰不再是機率 —— 要嘛那一條判定每次都成立，要嘛每次都不成立。
  // `hits` 是「六面中命中幾面」，下游一律拿它除以 6 當機率用，所以確定命中就是滿 6，
  // 確定落空就是 0。多擲幾次的那種效果也一樣：每一次都是同一面。
  if (charaDieFace) {
    const hit = mv.chara.find(ce => ce.orientations.includes(charaDieFace))
    return hit
      ? [{ ce: hit, hits: CHARA_DIE_FACE_COUNT, weight: 1 }]
      : [{ ce: null, hits: 0, weight: 1 }]
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

// 有重擲時，每一面的機率不再是 k/6。玩家只有在當下這面不如其他還可能擲到的面時才會重擲，
// 所以最終結果等於「擲 r+1 次裡最好的那一面」。把分支按價值由高到低排序、取累積機率 C_i，
// 落在第 i 名（或更好）的機率是 1-(1-C_i)^(r+1)，相減就是這一支自己的權重。
//
// 三種情況不適用，維持原權重：骰子被禁（沒有面可選）、骰面被固定（沒有隨機性可利用）、
// 以及招式自己就要擲好幾次角色骰的那種（那顆骰不歸玩家支配）。
function rerolledWeights(resolved, rerolls, mv, charaDiceInPlay, charaDieFace) {
  const natural = resolved.map(entry => entry.branch.weight)
  if (!(rerolls > 0) || !charaDiceInPlay || charaDieFace || resolved.length < 2) return natural
  if (mv.chara.some(ce => MULTI_ROLL_CHARA.test(ce.type))) return natural

  const throws = rerolls + 1
  const order = resolved.map((entry, i) => i).sort((a, b) => resolved[b].net - resolved[a].net)
  const weights = new Array(resolved.length).fill(0)
  let cumulative = 0
  order.forEach(i => {
    const before = cumulative
    cumulative += natural[i]
    weights[i] = Math.pow(1 - before, throws) - Math.pow(1 - cumulative, throws)
  })
  return weights
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
 * @param {string|null} [options.charaDieFace]  an orientation ('立'/'逆'/'上'/'下'/'左'/'右')
 *   the character die is stuck on, so its effects stop being a probability and become a
 *   certainty either way. Ignored when the die is blocked outright.
 * @param {number} [options.charaDieRerolls]  how many extra throws of the character die the
 *   caster gets. The die is rerolled only when the face it shows is worth less than one it
 *   could still find, so the outcome is the best of `charaDieRerolls + 1` throws. Ignored
 *   when the die is blocked, pinned to a face, or owned outright by a multi-roll effect.
 * @param {number|null} [options.selfHp]  remaining HP, or null to leave HP conditions unmet
 * @param {number|null} [options.maxHp]   full HP, so healing can be capped at what is
 *                                        actually missing; null values a heal at its
 *                                        printed figure and flags it
 * @param {number|null} [options.enemyLastDamage]  printed damage of the opponent's last
 *                                                  move, for the one move that copies it;
 *                                                  null leaves it uncounted
 * @param {object} [options.prev]  which previous-turn premises hold
 * @param {boolean} [options.countDefensiveValue]  credit damage reduction as HP kept
 * @param {object} [options.selfTempoValues]  the caster's own dice prices (selfDiceValues).
 *   Used for the effects aimed at the caster — losing or gaining their own dice, rerolling
 *   their own character die — where the exact cost to this deck is computable and the
 *   reference-opponent mean in `tempoValues` is only a stand-in. Falls back to `tempoValues`.
 */
export function moveExpectedValue(mv, options) {
  const {
    rolls,
    enemyDice = null,
    charaDiceInPlay = true,
    charaDieFace = null,
    charaDieRerolls = 0,
    selfHp = null,
    maxHp = null,
    enemyLastDamage = null,
    prev = {},
    countDefensiveValue = false,
    tempoValues = null,
    selfTempoValues = null
  } = options

  const odds = payableCount(rolls, mv.cost)
  const pSuccess = odds.total > 0 ? odds.payable / odds.total : 0

  // Both of these cost a pass of their own and only one printed move each needs them, so
  // they stay lazy and memoised rather than being computed for every move in the list.
  const payingTypeMeanCache = new Map()
  let enemyDiceMeanCache = null
  const env = {
    charaHits: CHARA_DIE_FACE_COUNT,
    selfHp,
    maxHp,
    enemyLastDamage,
    countDefensiveValue,
    tempoValues,
    selfTempoValues,
    prev: {
      enemyMoveFailed: false,
      selfMoveFailed: false,
      prereqMoveSucceeded: false,
      ...prev
    },
    // The move's own type, for the bare DAMAGE_EXTRA_ENE that means "count my own energy".
    moveType: mv.type,
    payingTypeMean: countedType => {
      if (!payingTypeMeanCache.has(countedType)) {
        payingTypeMeanCache.set(countedType, conditionalTypeMean(rolls, mv.cost, countedType))
      }
      return payingTypeMeanCache.get(countedType)
    },
    enemyDiceMean: () => {
      if (!enemyDice || enemyDice.length === 0) return null
      if (enemyDiceMeanCache === null) enemyDiceMeanCache = largestTypePileMean(enemyDice)
      return enemyDiceMeanCache
    }
  }

  const notes = new Map()
  let repeatWeight = 0
  let damageOnHit = 0
  let selfOnHit = 0
  let defensiveOnHit = 0
  let healOnHit = 0
  let tempoOnHit = 0

  // Resolved first, weighted second: a reroll's weights depend on which branch is worth more,
  // which isn't known until every branch has been resolved.
  const resolved = buildBranches(mv, charaDiceInPlay, charaDieFace).map(branch => {
    const state = resolveBranch(mv, branch.ce, { ...env, charaHits: branch.hits })
    // Mirrors proceedToAnimateWithCtx: a move can't heal the opponent, so damage floors at 0.
    const damage = Math.max(state.damage, 0)
    return {
      branch,
      state,
      damage,
      net: damage - state.self + state.defensive + state.heal + state.tempo
    }
  })
  const weights = rerolledWeights(resolved, charaDieRerolls, mv, charaDiceInPlay, charaDieFace)

  const branches = resolved.map((entry, i) => {
    const { branch, state, damage, net } = entry
    const weight = weights[i]
    damageOnHit += weight * damage
    selfOnHit += weight * state.self
    defensiveOnHit += weight * state.defensive
    healOnHit += weight * state.heal
    tempoOnHit += weight * state.tempo
    if (state.repeats) repeatWeight += weight
    state.notes.forEach((kind, type) => addNote({ notes }, type, kind))
    return {
      orientations: branch.ce ? branch.ce.orientations : null,
      probability: weight,
      damage,
      self: state.self,
      net
    }
  })

  let evDamage = pSuccess * damageOnHit
  let evSelf = pSuccess * selfOnHit
  let evDefensive = pSuccess * defensiveOnHit
  let evHeal = pSuccess * healOnHit
  let evTempo = pSuccess * tempoOnHit

  // What a successful cast deals before the character die contributes anything: the printed
  // damage plus the move's own effect. It is worked out directly rather than read off the
  // "die missed" branch, because a move whose effect entries cover all six faces — or which
  // throws the die several times of its own accord — has no such branch to read.
  const baseline = resolveBranch(mv, null, { ...env, charaHits: 0 })
  const evDamageBase = pSuccess * Math.max(baseline.damage, 0)

  // A repeat is a fresh cast of the same move — new energy roll, new character die — so the
  // total is the fixed point of "value of one cast, plus another whole go at probability q".
  if (repeatWeight > 0) {
    const q = pSuccess * repeatWeight
    if (q < 1) {
      const casts = 1 / (1 - q)
      evDamage *= casts
      evSelf *= casts
      evDefensive *= casts
      evHeal *= casts
      evTempo *= casts
    }
  }

  // The six figures add up to `ev` exactly (evSelf counts against it), so a caller can lay
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
    evHeal,
    evTempo,
    ev: evDamage - evSelf + evDefensive + evHeal + evTempo,
    branches,
    notes: [...notes].map(([type, kind]) => ({ type, kind }))
  }
}
