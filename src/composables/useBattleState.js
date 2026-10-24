import { reactive } from 'vue'
import { loadMoveHistory, saveMoveHistoryForChar } from '../data/moveHistory'
import { computeDisplayDamage as computeDisplayDamagePure, isCharaColorConditionMet, applyNullifyAtMost } from '../game/damage'
import { runEffectQueue as runEffectQueueShared } from '../game/effectQueue'
import { canPayCost } from '../game/energyPayment'

// Set by useOnlineRoom on host()/join()/leave(). Lets the handful of effect hooks below tell
// "real synced dice are available" (online) from "nothing to read but a self-report" (hotseat/
// solo) without threading an online flag through every call in the shared effect-queue engine.
let onlineModeActive = false
export function setOnlineMode(v) {
  onlineModeActive = v
}

// Pending completions for the two online-only "extra real dice roll" tasks below. Functions
// can't survive the host->guest state broadcast (see stripFns in useOnlineRoom.js), so — like
// state.effectPrompt.onPick — these live outside reactive state and only ever run on the host,
// which is the only client that actually executes resolveTurn()/the effect queue.
let pendingCharaThrowDone = null
let pendingEnergyThrowDone = null

function newPlayer() {
  return {
    character: null,
    moveIds: [],
    locked: false,
    hp: 0,
    maxHp: 0,
    lastMoveId: null,
    incomingDamageMod: 0,
    incomingDamageNullify: null,
    // NULLIFY_TAKEN_LE: the next hit is dropped if its final figure is at most this. Same
    // lifecycle as incomingDamageNullify.
    incomingDamageNullifyAtMost: null,
    // Whether a move's damage landed on this player during the opponent's most recent turn —
    // read by DAMAGE_EXTRA_IF_UNHURT. Cleared when the opponent's turn starts.
    tookMoveDamage: false,
    // REROLL_DICE_ENEMY: how many of this player's energy dice the opponent may make them
    // re-throw on their next turn. REROLL_CHARADICE_SELF: how many times this player may
    // re-throw their own character die on their next turn. Both cleared when that turn resolves.
    energyRerollByOpponent: 0,
    charaRerolls: 0,
    // SPECIAL_PICK_ENEMY_WAZA: { sourceName, sourceType } while the opponent picks this
    // player's next move; null the rest of the time.
    movePickedByOpponent: null,
    diceMod: 0,
    diceModBadges: [],
    bannedMoveIds: [],
    bannedMoveSourceName: "",
    committedBannedMoveIds: [],
    committedBannedMoveSourceName: "",
    charaDiceBlocked: false,
    // Online-only: this side has tapped "ready" and is waiting for the opponent, so the first
    // player can be drawn instead of either side just picking themselves. Unused in hotseat.
    readyForFirst: false,
    // Online-only: this side's fixed set of 3 energy dice (same shape as the dice assembly
    // simulator's), thrown every turn for the rest of the match once configured.
    energyDice: null,
    // { value, orientations } while another move has pinned this player's character die for
    // their next turn; null the rest of the time. Same lifecycle as charaDiceBlocked above.
    fixCharaDice: null,
    lastMoveFailed: false,
    committedLastMoveId: null,
    committedLastMoveFailed: false,
    // transient visual effects (replace imperative DOM manipulation from the original demo)
    attackAnim: null,
    hitBlink: false,
    dmgOverlay: null,
    frameOut: false
  }
}

function freshState() {
  return {
    phase: "select",
    players: { A: newPlayer(), B: newPlayer() },
    // Online-only: the side the first-pick wheel has landed on, set before `firstPlayer` while
    // phase is "drawingFirst" so both clients animate toward the same result.
    pendingFirstPick: null,
    firstPlayer: null,
    turnPlayer: null,
    turnCount: 0,
    // One char/move-select modal slot per player — see openCharSelect()'s comment for why.
    modals: { A: null, B: null },
    selectedMove: null,
    winner: null,
    revealed: false,
    effectPrompt: null,
    repeatActive: false,
    turnCutIn: null,
    // Online only: this turn's 3D dice-throw result (see DiceOverlay.vue / clearDiceRoll()),
    // reset whenever a fresh dice-roll phase begins.
    charaDieFace: null,
    energyRolledTypes: null,
    // Online only: the same roll split per die (one array of types per thrown die), which is
    // what an energy reroll needs to swap out single dice.
    energyRolledDice: null,
    energySuccess: null,
    diceTransforms: null,
    // Online only: REROLL_DICE_ENEMY in progress on this turn's energy roll — see
    // beginEnergyRerollTask(). `energyRerollDone` stops it from triggering twice in one turn.
    energyRerollTask: null,
    energyRerollDone: false,
    // Online only: gates the handoff to the next turn behind the receiving side actually
    // acknowledging the damage + dice result — see showTurnResultConfirm()/confirmTurnResult().
    turnResult: null,
    // Online only: an extra real character-die throw is in progress (either side's own die) —
    // see beginCharaThrowTask()/submitCharaThrowResult().
    charaThrowTask: null,
    // Online only: an extra real energy-dice throw (always the opponent's own configured set)
    // is in progress — see beginEnergyThrowTask()/submitEnergyThrowResult().
    energyThrowTask: null
  }
}

const state = reactive(freshState())

export function useBattleState(movesRef) {
  function opponentKey(k) {
    return k === "A" ? "B" : "A"
  }

  function bothLocked() {
    return state.players.A.locked && state.players.B.locked
  }

  function hpBarClass(p) {
    if (p.maxHp <= 0) return ""
    const ratio = p.hp / p.maxHp
    if (ratio <= .2) return "crit"
    if (ratio <= .5) return "low"
    return ""
  }

  function computeDisplayDamage(mv, mover, target) {
    return computeDisplayDamagePure(mv, mover, target, movesRef.value)
  }

  // --- character/move selection (phase: "select") ---
  //
  // One modal slot per player (state.modals.A / state.modals.B), not a single shared one: with
  // only one slot, whichever side opened their picker SECOND overwrote it, so the FIRST side's
  // open modal (which the state watch then re-broadcasts) would vanish out from under them —
  // the same class of bug the energy-dice setup had before it moved to fully local state. Here
  // the modal still needs to be synced (so the opponent's "對方選擇中" status can read it), so
  // each side gets its own slot instead of going local.

  function openCharSelect(key) {
    state.modals[key] = { type: "char", playerKey: key, tempChar: null }
  }

  function openMoveSelect(key, char) {
    const hist = loadMoveHistory()
    const saved = hist[char.id]
    const validSaved = Array.isArray(saved) && saved.length === 4 && saved.every(mid => char.moves.includes(mid))
    state.modals[key] = { type: "move", playerKey: key, tempChar: char, tempMoves: validSaved ? [...saved] : [] }
  }

  function closeModal(key) {
    state.modals[key] = null
  }

  function toggleMoveInModal(key, mid) {
    const m = state.modals[key]
    if (!m) return
    if (m.tempMoves.includes(mid)) {
      m.tempMoves = m.tempMoves.filter(x => x !== mid)
    } else if (m.tempMoves.length < 4) {
      m.tempMoves.push(mid)
    }
  }

  function confirmCharacterMoves(key) {
    const m = state.modals[key]
    if (!m || m.tempMoves.length !== 4) return
    const p = state.players[key]
    p.character = m.tempChar
    p.moveIds = m.tempMoves
    p.locked = true
    p.hp = m.tempChar.hp
    p.maxHp = m.tempChar.hp
    saveMoveHistoryForChar(m.tempChar.id, m.tempMoves)
    state.modals[key] = null
  }

  function onCardTap(key) {
    const p = state.players[key]
    if (state.phase !== "select") return
    if (!p.locked) {
      openCharSelect(key)
    } else {
      openMoveSelect(key, p.character)
      state.modals[key].tempMoves = [...p.moveIds]
    }
  }

  // Online-only: marks this side ready to start; useOnlineRoom watches for both sides being
  // ready and runs the first-pick wheel, then calls startBattle() itself once it lands.
  function setReadyForFirst(key) {
    state.players[key].readyForFirst = true
  }

  // --- energy dice setup (online-only, phase: "select") ---
  // Each side configures a fixed set of 3 energy dice once before the match starts (same shape
  // as the dice assembly simulator's), and every turn's energy throw actually draws from this —
  // unlike the character die, there's no universal fixed energy die, so this can't be skipped.
  // The editing itself happens entirely in EnergyDiceModal's own local state, not state.modal —
  // two people configuring their own dice at the same time is the common case here (unlike
  // char/move picking), and sharing one state.modal slot meant whoever confirmed second stole
  // or closed the other side's picker. This is the one synced step: the finished result.
  function setEnergyDice(key, dice) {
    state.players[key].energyDice = dice
  }

  function startBattle(firstKey) {
    state.firstPlayer = firstKey
    state.turnPlayer = firstKey
    state.turnCount = 0
    state.revealed = true
    state.phase = "moveSelect"
    showTurnCutIn(firstKey)
  }

  // --- move / dice / effect resolution (phases: moveSelect, diceRoll, resolve, effectPrompt) ---

  function clearDiceRoll() {
    state.charaDieFace = null
    state.energyRolledTypes = null
    state.energyRolledDice = null
    state.energySuccess = null
    state.diceTransforms = null
    state.energyRerollTask = null
    state.energyRerollDone = false
  }

  function pickMove(mid) {
    state.selectedMove = mid
    clearDiceRoll()
    state.phase = "diceRoll"
  }

  function backToMoveSelect() {
    if (state.repeatActive) return
    // The opponent chose this move (SPECIAL_PICK_ENEMY_WAZA); going back would let the mover
    // swap it for one of their own choosing.
    if (state.players[state.turnPlayer].movePickedByOpponent) return
    state.selectedMove = null
    clearDiceRoll()
    state.phase = "moveSelect"
  }

  // Online only: called once the active side's 3D throw (energy dice + character die) settles
  // (see DiceOverlay.vue). `energyRolledTypes` is the flat list of energy types actually rolled
  // (so the opponent can see the full result, not just the pass/fail verdict); `energySuccess`
  // is the real cost check (canPayCost against those types); `transforms` is each die's exact
  // final position/quaternion from that physics run, broadcast so the opponent's canvas can
  // replay the identical result instead of guessing.
  function setDiceRollResult(charaDieFace, energyRolledTypes, energySuccess, transforms, energyRolledDice = null) {
    state.charaDieFace = charaDieFace
    state.energyRolledTypes = energyRolledTypes
    state.energyRolledDice = energyRolledDice
    state.energySuccess = energySuccess
    state.diceTransforms = transforms
    const mover = state.players[state.turnPlayer]
    if (onlineModeActive && mover.energyRerollByOpponent > 0 && !state.energyRerollDone && energyRolledDice && energyRolledDice.length > 0) {
      beginEnergyRerollTask()
    }
  }

  // --- REROLL_DICE_ENEMY (online only) ---
  //
  // After the mover's throw settles, the side that cast the reroll picks which of the mover's
  // energy dice get thrown again ("振りなおすエネコロは自分が選ぶ"), then the mover's own
  // client re-throws just those, and the cost check is redone on the combined result. Hotseat
  // and solo throw physical dice, so there the effect is only a badge reminding both players.
  //
  // The dice actually thrown this turn are captured into the task up front (the same cycling
  // DiceOverlay's diceForThrow() does), so the re-throw can't drift from what was rolled.
  function beginEnergyRerollTask() {
    const moverKey = state.turnPlayer
    const mover = state.players[moverKey]
    const isFirstTurn = state.turnCount === 0
    const energyCount = Math.max(0, (isFirstTurn ? 2 : 3) + (mover.diceMod || 0))
    const config = mover.energyDice || []
    const dice = Array.from({ length: energyCount }, (_, i) => config[i % config.length])
    state.energyRerollTask = {
      pickerKey: opponentKey(moverKey),
      rollerKey: moverKey,
      count: Math.min(mover.energyRerollByOpponent, dice.length),
      dice,
      picked: [],
      stage: 'pick',
      transforms: null
    }
    state.energyRerollDone = true
    state.phase = "energyReroll"
  }

  function toggleEnergyRerollPick(index) {
    const t = state.energyRerollTask
    if (!t || t.stage !== 'pick') return
    if (t.picked.includes(index)) t.picked = t.picked.filter(i => i !== index)
    else if (t.picked.length < t.count) t.picked.push(index)
  }

  // Picking nothing is allowed — the caster may like the roll as it stands.
  function confirmEnergyRerollPick() {
    const t = state.energyRerollTask
    if (!t || t.stage !== 'pick') return
    if (t.picked.length === 0) {
      finishEnergyReroll()
      return
    }
    t.stage = 'throw'
  }

  // `perDieTypes[i]` is the result for the i-th entry of `picked`.
  function submitEnergyRerollResult(perDieTypes, transforms) {
    const t = state.energyRerollTask
    if (!t || t.stage !== 'throw') return
    const dice = state.energyRolledDice.map(types => [...types])
    t.picked.forEach((dieIndex, i) => { dice[dieIndex] = perDieTypes[i] || [] })
    t.transforms = transforms
    const flat = dice.flat()
    const mv = movesRef.value[state.selectedMove]
    state.energyRolledDice = dice
    state.energyRolledTypes = flat
    state.energySuccess = canPayCost(flat, mv.cost)
    finishEnergyReroll()
  }

  function finishEnergyReroll() {
    state.energyRerollTask = null
    // The main throw's pose no longer matches the result, so the opponent's replay is dropped
    // rather than shown out of step with the icons beside it.
    state.diceTransforms = null
    state.phase = "diceRoll"
  }

  // --- REROLL_CHARADICE_SELF (online only) ---
  //
  // Re-throws just the character die as a real synced throw, replacing this turn's face. The
  // remaining count is spent here; whatever's left unused lapses when the turn resolves.
  function rerollCharaDie() {
    const moverKey = state.turnPlayer
    const mover = state.players[moverKey]
    if (!onlineModeActive || !(mover.charaRerolls > 0) || !state.charaDieFace) return
    mover.charaRerolls--
    const mv = movesRef.value[state.selectedMove]
    const orientations = [...new Set((mv.chara || []).flatMap(ce => ce.orientations))]
    beginCharaThrowTask(moverKey, orientations, 'single', null, 0, face => {
      state.charaDieFace = face
      state.phase = "diceRoll"
    }, 'face')
  }

  const effectQueueHooks = {
    showDicePrompt,
    showCharaDiceCountPrompt,
    showCharaDiceRepeatPrompt,
    showBindWazaPrompt,
    showEneCountPrompt,
    showCharaDiceEnemyManualPrompt,
    showCharaDiceComboEnemyPrompt,
    showCharaDiceSelectPrompt,
    showSwapChipPrompt
  }

  function resolveTurn(result) {
    const MOVES = movesRef.value
    const moverKey = state.turnPlayer
    const mover = state.players[moverKey]
    const oppKey = opponentKey(moverKey)
    const opp = state.players[oppKey]
    const mv = MOVES[state.selectedMove]
    mover.lastMoveId = state.selectedMove
    mover.lastMoveFailed = result.kind === "fail"
    mover.bannedMoveIds = []
    mover.bannedMoveSourceName = ""
    mover.diceMod = 0
    mover.diceModBadges = []
    mover.charaDiceBlocked = false
    mover.fixCharaDice = null
    mover.energyRerollByOpponent = 0
    mover.charaRerolls = 0
    mover.movePickedByOpponent = null
    // A repeat is the same turn carrying on, so a hit from its first cast still counts.
    if (!state.repeatActive) opp.tookMoveDamage = false
    state.phase = "resolve"

    if (result.kind === "fail") {
      opp.incomingDamageMod = 0
      opp.incomingDamageNullify = null
      opp.incomingDamageNullifyAtMost = null
      proceedToAnimateWithCtx({ moverKey, mover, oppKey, opp, mv, dmgToOpp: 0, dmgToSelf: 0, isMiss: true })
      return
    }

    const queue = []
    if (mv.effectType) queue.push({ type: mv.effectType, value: mv.effectValue })
    if (result.kind === "chara" && result.ce && result.ce.type) {
      queue.push({ type: result.ce.type, value: result.ce.value })
    }
    // `ce` (the character-die effect the player picked, with its own `.orientations`) rides
    // along on ctx so hooks below can tell which orientations to keep re-checking on any further
    // real throws of that same die — only meaningful when this turn's effect came from a chara
    // pick, null otherwise.
    const ce = result.kind === "chara" ? result.ce : null
    const ctx = { moverKey, mover, oppKey, opp, mv, ce, dmgToOpp: result.dmgInfo.raw, dmgToSelf: 0 }
    runEffectQueueShared(queue, 0, ctx, effectQueueHooks, () => proceedToAnimateWithCtx(ctx))
  }

  // --- effect prompts (state.effectPrompt / phase: "effectPrompt") ---
  //
  // Online only: every one of these except bindWaza is fundamentally a request to read a die
  // that nobody's self-reporting can actually see any more once physical props are gone — see
  // beginCharaThrowTask()/beginEnergyThrowTask() below, which make each one a real synced throw
  // instead. Hotseat/solo have no real dice to read, so they keep the original self-report
  // overlay (state.effectPrompt) unconditionally; solo mode's own useSoloRun.js mirrors these
  // functions rather than sharing them (no online concept there at all).

  function showDicePrompt(n, multiplier, ctx, onPick) {
    // ミュウ「サイコキネシス」: opponent throws n of their own configured energy dice; damage is
    // the count of whichever type came up most (each die can contribute up to 2 hits via a dual
    // chip face, hence up to 2n instances of one type — matches the original n*2 button range).
    if (onlineModeActive) {
      beginEnergyThrowTask(ctx.oppKey, n, onPick)
      return
    }
    state.effectPrompt = { kind: "diceNumber", max: n * 2, multiplier, onPick }
    state.phase = "effectPrompt"
  }

  // サンダー「ダブルサンダー/ボルトラッシュ」: this move throws the character die n times total;
  // the one that already landed for real this turn (and matched ctx.ce.orientations — that's
  // exactly why this chara option was selectable, see charaAvailable() in DiceOverlay.vue)
  // counts as the first, so only n-1 more real throws are needed.
  function showCharaDiceCountPrompt(n, effectValue, ctx, onPick) {
    if (onlineModeActive && ctx.ce && ctx.ce.orientations) {
      beginCharaThrowTask(ctx.moverKey, ctx.ce.orientations, 'count', n - 1, 1, onPick)
      return
    }
    const dmgInfo = computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp)
    state.effectPrompt = { kind: "charaDiceCount", n, effectValue, mv: ctx.mv, dmgInfo, mover: ctx.mover, opp: ctx.opp, onPick }
    state.phase = "effectPrompt"
  }

  // サンダー「サンダーチェイン」: same die, but repeats for real until a throw finally misses
  // ctx.ce.orientations, rather than a fixed count.
  function showCharaDiceRepeatPrompt(effectValue, ctx, onPick) {
    if (onlineModeActive && ctx.ce && ctx.ce.orientations) {
      beginCharaThrowTask(ctx.moverKey, ctx.ce.orientations, 'repeat', null, 1, onPick)
      return
    }
    const dmgInfo = computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp)
    state.effectPrompt = { kind: "charaDiceRepeat", effectValue, mv: ctx.mv, dmgInfo, mover: ctx.mover, opp: ctx.opp, onPick }
    state.phase = "effectPrompt"
  }

  // Not a dice read at all — a genuine strategic pick (which of the opponent's own moves to
  // ban), so it stays a menu in every mode. Answerable only by ep.targetKey (see
  // EffectPromptOverlay.vue's read-only gating).
  function showBindWazaPrompt(targetKey, count, onDone) {
    state.effectPrompt = { kind: "bindWaza", targetKey, count, picked: [], onDone }
    state.phase = "effectPrompt"
  }

  // ヒトカゲ「フレアストーム」: "the count of [move-type] energy that came up" refers to THIS
  // turn's own energy roll (state.energyRolledTypes) — the one already thrown for the move's
  // own cost check — not a new roll. Same shape as the charaDiceSelect 'self' fix: read it
  // straight from the real result instead of asking the player to recount it by hand.
  // `eneType` is the counted type when it isn't the move's own (DAMAGE_EXTRA_ENE_<type>).
  function showEneCountPrompt(effectValue, ctx, onPick, eneType = null) {
    const countedType = eneType || ctx.mv.type
    if (onlineModeActive && state.energyRolledTypes) {
      const count = state.energyRolledTypes.filter(ty => ty === countedType).length
      onPick(count)
      return
    }
    const dmgInfo = computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp)
    state.effectPrompt = { kind: "eneCount", effectValue, eneType: countedType, mv: ctx.mv, dmgInfo, mover: ctx.mover, opp: ctx.opp, onPick }
    state.phase = "effectPrompt"
  }

  // ベトベター「ベノムスリップ」/ イワーク「ジャイロボール」: a single real throw of the
  // opponent's own character die, checked against `orientations`.
  function showCharaDiceEnemyManualPrompt(orientations, effectValue, ctx, onPick) {
    if (onlineModeActive) {
      beginCharaThrowTask(ctx.oppKey, orientations, 'single', null, 0, onPick, 'bool')
      return
    }
    const dmgInfo = computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp)
    state.effectPrompt = { kind: "charaDiceEnemyManual", orientations, effectValue, mv: ctx.mv, dmgInfo, mover: ctx.mover, opp: ctx.opp, onPick }
    state.phase = "effectPrompt"
  }

  // ゲンガー「ファントムトリック」: the opponent rolls their character die n times for real;
  // each one that matches `orientations` counts (a running count, not a single yes/no — that's
  // what separates it from the prompt above).
  function showCharaDiceComboEnemyPrompt(n, orientations, effectValue, ctx, onPick) {
    if (onlineModeActive) {
      beginCharaThrowTask(ctx.oppKey, orientations, 'count', n, 0, onPick)
      return
    }
    const dmgInfo = computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp)
    state.effectPrompt = { kind: "charaDiceComboEnemy", n, orientations, effectValue, mv: ctx.mv, dmgInfo, mover: ctx.mover, opp: ctx.opp, onPick }
    state.phase = "effectPrompt"
  }

  // The player reports which orientation their character die actually showed, and that becomes
  // the orientation their (or the opponent's) die is pinned to next turn.
  //
  // Online only: for the 'self' target this is asking about the mover's OWN character die —
  // the same one already thrown for real this turn (state.charaDieFace). This effect only ever
  // fires once that real roll already matched one of `orientations` (see charaAvailable() in
  // DiceOverlay.vue), so asking the player to self-report which one it was would just be asking
  // them to repeat back a result the app already has, and would let them pick a different (wrong)
  // one. Resolve straight from the real roll instead of prompting. The 'enemy' target is a real
  // single throw of the opponent's own die (unused by the current roster, but kept real for
  // whenever a future move needs it, same as the pair in effectQueue.js).
  function showCharaDiceSelectPrompt(orientations, effectValue, ctx, target, onPick) {
    if (target === 'self' && state.charaDieFace && orientations.includes(state.charaDieFace)) {
      onPick(state.charaDieFace)
      return
    }
    if (onlineModeActive && target === 'enemy') {
      beginCharaThrowTask(ctx.oppKey, orientations, 'single', null, 0, onPick, 'face')
      return
    }
    const dmgInfo = computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp)
    state.effectPrompt = { kind: "charaDiceSelect", orientations, effectValue, target, mv: ctx.mv, dmgInfo, mover: ctx.mover, opp: ctx.opp, onPick }
    state.phase = "effectPrompt"
  }

  // SPECIAL_SWAP_CHIP: online only, since that's the one mode holding the dice as data — the
  // mover re-chips one of their own configured dice (EnergyDiceModal in swap mode) and every
  // later throw uses the new chips. Hotseat dice are physical, so it's done at the table.
  function showSwapChipPrompt(effectValue, ctx, onDone) {
    if (!onlineModeActive || !ctx.mover.energyDice) {
      onDone()
      return
    }
    state.effectPrompt = {
      kind: "swapChip",
      targetKey: ctx.moverKey,
      mvName: ctx.mv.name,
      onPick: picked => {
        if (picked && Number.isInteger(picked.dieIndex) && picked.die) {
          const dice = [...ctx.mover.energyDice]
          dice[picked.dieIndex] = picked.die
          ctx.mover.energyDice = dice
        }
        onDone()
      }
    }
    state.phase = "effectPrompt"
  }

  // --- online-only real "extra dice throw" tasks (state.charaThrowTask / state.energyThrowTask) ---
  //
  // Both follow the same shape as the main dice-overlay throw: whichever client owns
  // `rollerKey` runs the real physics and reports the settled face(s) + transforms; the other
  // side just replays the same transforms (see ExtraRollOverlay.vue). Only the host ever holds
  // a live `pendingXDone` callback — the guest's UI drives entirely off the synced task object.

  // `mode`: 'single' (one throw, resolves immediately) | 'count' (exactly `targetN` more throws,
  // hit or miss) | 'repeat' (keep throwing until one misses). `resultKind` (single mode only):
  // 'bool' (did it match) | 'face' (which orientation it landed on).
  function beginCharaThrowTask(rollerKey, orientations, mode, targetN, startCount, onDone, resultKind = 'count') {
    if (mode === 'count' && targetN <= 0) {
      onDone(startCount)
      return
    }
    state.charaThrowTask = { rollerKey, orientations, mode, targetN, successCount: startCount, resultKind, lastFace: null, transforms: null }
    state.phase = "charaThrowTask"
    pendingCharaThrowDone = onDone
  }

  function finishCharaThrowTask(result) {
    const cb = pendingCharaThrowDone
    state.charaThrowTask = null
    pendingCharaThrowDone = null
    state.phase = "resolve"
    cb(result)
  }

  // Called (via dispatch, if the roller is the guest) once that client's own throw settles.
  function submitCharaThrowResult(face, transforms) {
    const t = state.charaThrowTask
    if (!t) return
    const success = t.orientations.includes(face)
    t.lastFace = face
    t.transforms = transforms
    if (t.mode === 'single') {
      finishCharaThrowTask(t.resultKind === 'face' ? face : success)
      return
    }
    if (success) t.successCount++
    if (t.mode === 'count') {
      t.targetN--
      if (t.targetN <= 0) finishCharaThrowTask(t.successCount)
      return
    }
    // 'repeat': stop the moment one misses; otherwise stay in phase for another throw.
    if (!success) finishCharaThrowTask(t.successCount)
  }

  function beginEnergyThrowTask(rollerKey, n, onDone) {
    state.energyThrowTask = { rollerKey, n, rolledTypes: null, transforms: null }
    state.phase = "energyThrowTask"
    pendingEnergyThrowDone = onDone
  }

  function submitEnergyThrowResult(rolledTypes, transforms) {
    const t = state.energyThrowTask
    if (!t) return
    const counts = {}
    rolledTypes.forEach(ty => { counts[ty] = (counts[ty] || 0) + 1 })
    const maxCount = Object.values(counts).reduce((m, c) => Math.max(m, c), 0)
    const cb = pendingEnergyThrowDone
    state.energyThrowTask = null
    pendingEnergyThrowDone = null
    state.phase = "resolve"
    cb(maxCount)
  }

  function submitEffectPrompt(value) {
    const ep = state.effectPrompt
    if (!ep) return
    const cb = ep.onPick
    state.effectPrompt = null
    state.phase = "resolve"
    cb(value)
  }

  function pickBindWazaMove(mid) {
    const ep = state.effectPrompt
    if (!ep || ep.kind !== "bindWaza") return
    if (ep.picked.includes(mid)) return
    ep.picked.push(mid)
    if (ep.picked.length >= ep.count) {
      const cb = ep.onDone
      const picked = ep.picked.slice()
      state.effectPrompt = null
      state.phase = "resolve"
      cb(picked)
    }
  }

  // --- damage animation + turn handoff ---

  function playEffectOn(targetKey, type, dmg, cb, attackerKey, isMiss) {
    const isHeal = dmg < 0
    const doHit = () => {
      const target = state.players[targetKey]
      const didBlink = !isMiss && !isHeal && dmg > 0
      if (didBlink) target.hitBlink = true
      target.dmgOverlay = { text: isHeal ? `+${-dmg}` : (isMiss ? "MISS" : (dmg > 0 ? `-${dmg}` : "0")), heal: isHeal }
      setTimeout(() => {
        target.hitBlink = false
        target.dmgOverlay = null
        cb()
      }, 550)
    }
    if (attackerKey) {
      const attacker = state.players[attackerKey]
      attacker.attackAnim = attackerKey === "A" ? "atk-right" : "atk-left"
      setTimeout(() => {
        attacker.attackAnim = null
        doHit()
      }, 550)
    } else {
      doHit()
    }
  }

  function frameOutDeadMon(key, cb) {
    state.players[key].frameOut = true
    setTimeout(cb, 1000)
  }

  function handOffTurn(oppKey) {
    state.turnPlayer = oppKey
    state.turnCount++
    state.selectedMove = null
    state.phase = "moveSelect"
    showTurnCutIn(oppKey)
  }

  // Online only: freezes the handoff on "resultConfirm" until oppKey's own client taps through
  // — see TurnResultOverlay.vue, which shows this turn's damage plus the mover's real dice
  // result (still readable off state.charaDieFace/energyRolledTypes/energySuccess; nothing else
  // touches those until clearDiceRoll() runs for the next pick).
  function showTurnResultConfirm(oppKey, mv, dmgToOpp) {
    state.turnResult = { oppKey, mvName: mv.name, mvType: mv.type, dmgToOpp }
    state.phase = "turnResultConfirm"
  }

  function confirmTurnResult() {
    const tr = state.turnResult
    if (!tr) return
    state.turnResult = null
    handOffTurn(tr.oppKey)
  }

  function showTurnCutIn(key) {
    const p = state.players[key]
    const isFirstTurn = state.turnCount === 0
    const energyCount = Math.max(0, (isFirstTurn ? 2 : 3) + (p.diceMod || 0))
    const hasChara = !p.charaDiceBlocked
    state.turnCutIn = { key, hasChara, energyCount }
    setTimeout(() => {
      state.turnCutIn = null
    }, 1970)
  }

  function proceedToAnimateWithCtx(ctx) {
    const { moverKey, mover, oppKey, opp, mv } = ctx
    const dmgToOpp = applyNullifyAtMost(opp, (opp.incomingDamageNullify !== null && opp.incomingDamageNullify !== undefined)
      ? Math.max(opp.incomingDamageNullify, 0)
      : Math.max(ctx.dmgToOpp, 0))
    const dmgToSelf = ctx.dmgToSelf

    playEffectOn(oppKey, mv.type, dmgToOpp, () => {
      opp.hp = Math.max(opp.hp - dmgToOpp, 0)
      if (dmgToOpp > 0) opp.tookMoveDamage = true

      const finishSelf = () => {
        if (opp.hp <= 0 || mover.hp <= 0) {
          let winnerKey
          if (opp.hp <= 0 && mover.hp <= 0) winnerKey = oppKey
          else if (opp.hp <= 0) winnerKey = moverKey
          else winnerKey = oppKey
          const deadKeys = []
          if (opp.hp <= 0) deadKeys.push(oppKey)
          if (mover.hp <= 0) deadKeys.push(moverKey)
          Promise.all(deadKeys.map(k => new Promise(res => frameOutDeadMon(k, res)))).then(() => {
            state.winner = winnerKey
            state.phase = "win"
          })
          return
        }
        if (ctx.repeatValue) {
          state.repeatActive = true
          clearDiceRoll()
          state.phase = "diceRoll"
          return
        }
        state.repeatActive = false
        opp.incomingDamageMod = 0
        opp.incomingDamageNullify = null
        opp.incomingDamageNullifyAtMost = null
        mover.committedLastMoveId = mover.lastMoveId
        mover.committedLastMoveFailed = mover.lastMoveFailed
        mover.committedBannedMoveIds = mover.bannedMoveIds
        mover.committedBannedMoveSourceName = mover.bannedMoveSourceName
        opp.committedBannedMoveIds = opp.bannedMoveIds
        opp.committedBannedMoveSourceName = opp.bannedMoveSourceName
        // Online only: the turn doesn't actually hand off until the side that just got hit taps
        // through a summary of the damage + dice result — otherwise the screen can flip to their
        // move-select before they've had a chance to see what happened (see
        // showTurnResultConfirm() below and TurnResultOverlay.vue).
        if (onlineModeActive) {
          showTurnResultConfirm(oppKey, mv, dmgToOpp)
          return
        }
        handOffTurn(oppKey)
      }

      if (dmgToSelf !== 0) {
        setTimeout(() => {
          playEffectOn(moverKey, mv.type, dmgToSelf, () => {
            if (dmgToSelf > 0) mover.hp = Math.max(mover.hp - dmgToSelf, 0)
            else mover.hp = Math.min(mover.hp - dmgToSelf, mover.maxHp)
            setTimeout(finishSelf, 1000)
          })
        }, 250)
      } else {
        setTimeout(finishSelf, 1000)
      }
    }, moverKey, !!ctx.isMiss)
  }

  function resetGame() {
    Object.assign(state, freshState())
  }

  return {
    state,
    opponentKey,
    bothLocked,
    hpBarClass,
    computeDisplayDamage,
    isCharaColorConditionMet,
    openCharSelect,
    openMoveSelect,
    closeModal,
    toggleMoveInModal,
    confirmCharacterMoves,
    onCardTap,
    startBattle,
    setReadyForFirst,
    setEnergyDice,
    pickMove,
    backToMoveSelect,
    setDiceRollResult,
    resolveTurn,
    submitEffectPrompt,
    pickBindWazaMove,
    confirmTurnResult,
    submitCharaThrowResult,
    submitEnergyThrowResult,
    toggleEnergyRerollPick,
    confirmEnergyRerollPick,
    submitEnergyRerollResult,
    rerollCharaDie,
    resetGame
  }
}
