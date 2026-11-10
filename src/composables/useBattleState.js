import { clearMods, modOf, modSum, STEP } from '../game/turnMods'
import { reactive } from 'vue'
import { loadMoveHistory, saveMoveHistoryForChar } from '../data/moveHistory'
import { computeDisplayDamage as computeDisplayDamagePure, isCharaColorConditionMet } from '../game/damage'
import { advanceEffectQueue } from '../game/effectQueue'

// Set by useOnlineRoom on host()/join()/leave(). Lets the handful of effect hooks below tell
// "real synced dice are available" (online) from "nothing to read but a self-report" (hotseat/
// solo) without threading an online flag through every call in the shared effect-queue engine.
let onlineModeActive = false
export function setOnlineMode(v) {
  onlineModeActive = v
}

// There are deliberately no stored callbacks in this module any more.
//
// Everything a turn is waiting on lives in reactive state — `effectCtx` (the queue and its
// position), `effectPrompt`, `charaThrowTask`, `energyThrowTask` — and every answer comes back
// through submitEffectPrompt, which resumes from that state. Functions could never survive the
// host->guest broadcast anyway (see stripFns in useOnlineRoom.js), but the real reason is
// resumability: a continuation held on the heap is lost when the page reloads, and the battle
// then stalls with no way to tell it what happens next.

function newPlayer() {
  return {
    character: null,
    moveIds: [],
    locked: false,
    hp: 0,
    maxHp: 0,
    lastMoveId: null,
    // Everything an effect planted on this player for their next turn, tagged with the
    // step it changes — see game/turnMods.js. One list, one lifecycle, in place of a
    // field per effect each with its own clearing.
    mods: [],
    // Whether this side took move damage on the turn that just finished. `committed` is the
    // settled value a later turn reads, mirroring committedLastMoveFailed.
    tookDamage: false,
    committedTookDamage: false,
    diceModBadges: [],
    // Online-only: this side has tapped "ready" and is waiting for the opponent, so the first
    // player can be drawn instead of either side just picking themselves. Unused in hotseat.
    readyForFirst: false,
    // Online-only: this side's fixed set of 3 energy dice (same shape as the dice assembly
    // simulator's), thrown every turn for the rest of the match once configured.
    energyDice: null,
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
    // Who the current step is waiting on. Usually `turnPlayer`, but an effect can hand the
    // decision to the other side — see enterPhase. null while nobody in particular is acting.
    actorKey: null,
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
    // The same roll, kept per die instead of flattened: [['みず'], ['みず','あく'], []]. The
    // flat list above cannot be unpicked, because a dual-chip face contributes two types from
    // one die — and ほりかえす / ジュエルフラッシュ need "which DIE" to make anyone reroll one.
    energyDieTypes: null,
    energySuccess: null,
    diceTransforms: null,
    // The effect queue's own position, while one is running. Everything here is plain data on
    // purpose: `hydrateEffectCtx` turns it back into a working context by looking the players
    // and the move up again, so a reload can resume instead of stalling on a half-run queue.
    // (The old design kept all of this in closures — see advanceEffectQueue's comment.)
    effectCtx: null,
    // { targetKey, byKey, n, from, indices } while somebody is naming which of the target's
    // energy dice must be rerolled; null otherwise. `indices` stays null until they choose.
    diceRerollRequest: null,
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

  /**
   * 用一方的代號拿到那一方。
   *
   * 存在的理由不是省字，是讓這個檔案裡的回合流程跟 useSoloRun 的那一份長得一樣 ——
   * 兩邊的狀態形狀不同（這裡是 state.players 這張表，單人爬塔是 state.player 與
   * state.ai 兩個鍵），而那幾個函式是一份一份對著抄的。抄到寫死形狀的那一行，就會
   * 讀到 undefined，而且要等效果佇列真的跑起來才會炸（單人爬塔就這樣壞過一次）。
   * 兩邊都只透過這一個函式取人，抄過去也還是對的。
   */
  function combatant(key) {
    return state.players[key]
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
    const p = combatant(key)
    p.character = m.tempChar
    p.moveIds = m.tempMoves
    p.locked = true
    p.hp = m.tempChar.hp
    p.maxHp = m.tempChar.hp
    saveMoveHistoryForChar(m.tempChar.id, m.tempMoves)
    state.modals[key] = null
  }

  function onCardTap(key) {
    const p = combatant(key)
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
    combatant(key).readyForFirst = true
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
    combatant(key).energyDice = dice
  }

  function startBattle(firstKey) {
    state.firstPlayer = firstKey
    state.turnPlayer = firstKey
    state.turnCount = 0
    state.revealed = true
    enterPhase("moveSelect", moveActorKey(firstKey))
    showTurnCutIn(firstKey)
  }

  // --- move / dice / effect resolution (phases: moveSelect, diceRoll, resolve, effectPrompt) ---

  /**
   * Move the battle to a new step, saying who is expected to act.
   *
   * The actor is the point. It used to be inferred — every screen read `turnPlayer` and
   * assumed that was whoever should be looking at it — which is wrong whenever an effect
   * hands the decision to the other side (そそのかす picks your move for you; ほりかえす has
   * one player choose dice and the other throw them). Each of those shipped as a bug where
   * the wrong client saw the controls, because there was nowhere to say otherwise.
   *
   * `actorKey` null means nobody in particular: a result everyone is just watching.
   */
  // Whose decision the move for `turnKey` is. そそのかす is the only thing that moves it.
  function moveActorKey(turnKey) {
    return modOf(combatant(turnKey), STEP.MOVE_SELECT, 'pickedByOpponent')
      ? opponentKey(turnKey)
      : turnKey
  }

  function enterPhase(kind, actorKey = state.turnPlayer) {
    state.phase = kind
    state.actorKey = actorKey
  }

  function clearDiceRoll() {
    state.charaDieFace = null
    state.energyRolledTypes = null
    state.energyDieTypes = null
    state.energySuccess = null
    state.diceTransforms = null
  }

  function pickMove(mid) {
    state.selectedMove = mid
    clearDiceRoll()
    enterPhase("diceRoll")
  }

  function backToMoveSelect() {
    if (state.repeatActive) return
    state.selectedMove = null
    clearDiceRoll()
    enterPhase("moveSelect", moveActorKey(state.turnPlayer))
  }

  // Online only: called once the active side's 3D throw (energy dice + character die) settles
  // (see DiceOverlay.vue). `energyRolledTypes` is the flat list of energy types actually rolled
  // (so the opponent can see the full result, not just the pass/fail verdict); `energySuccess`
  // is the real cost check (canPayCost against those types); `transforms` is each die's exact
  // final position/quaternion from that physics run, broadcast so the opponent's canvas can
  // replay the identical result instead of guessing.
  function setDiceRollResult(charaDieFace, energyRolledTypes, energySuccess, transforms, energyDieTypes = null) {
    state.charaDieFace = charaDieFace
    state.energyRolledTypes = energyRolledTypes
    state.energySuccess = energySuccess
    state.diceTransforms = transforms
    if (energyDieTypes) state.energyDieTypes = energyDieTypes

    // Somebody made this player's dice rerollable (ほりかえす / ジュエルフラッシュ). Hand the
    // choice of which ones to the player who cast it, before this roll is allowed to settle.
    const mover = combatant(state.turnPlayer)
    const forced = modOf(mover, STEP.DICE_ROLL, 'forcedReroll')
    if (forced && !state.diceRerollRequest) {
      state.diceRerollRequest = {
        targetKey: state.turnPlayer,
        byKey: opponentKey(state.turnPlayer),
        n: forced.n,
        from: forced.from,
        indices: null
      }
      // Spent the moment it becomes a request; the request itself is the live state now.
      mover.mods = mover.mods.filter(m => m !== forced)
      // A step of its own, and the one place in the game where the actor changes midway: the
      // player who cast it names the dice, the player who owns them throws. Saying so here
      // means no screen has to infer it, and the reroll panel wins by being the current phase
      // rather than by sitting earlier in a v-if chain.
      enterPhase("rerollPick", state.diceRerollRequest.byKey)
    }
  }

  /**
   * The caster names which of the opponent's dice have to go again.
   *
   * Only records the choice: the actual throw belongs to the client holding that player's
   * dice canvas, which watches for `indices` and rerolls exactly those (see DiceOverlay).
   */
  function submitDiceReroll(indices) {
    if (!state.diceRerollRequest || state.diceRerollRequest.indices) return
    state.diceRerollRequest = { ...state.diceRerollRequest, indices: [...indices] }
    enterPhase("rerollThrow", state.diceRerollRequest.targetKey)
  }

  function clearDiceRerollRequest() {
    state.diceRerollRequest = null
    // Back to the roll that was held up while this was resolved.
    enterPhase("diceRoll", state.turnPlayer)
  }

  function resolveTurn(result) {
    const MOVES = movesRef.value
    const moverKey = state.turnPlayer
    const mover = combatant(moverKey)
    const oppKey = opponentKey(moverKey)
    const opp = combatant(oppKey)
    const mv = MOVES[state.selectedMove]
    mover.lastMoveId = state.selectedMove
    mover.lastMoveFailed = result.kind === "fail"
    mover.diceModBadges = []
    // Consumed by the turn they applied to, alongside every other next-turn modifier.
    // The mover has now picked and acted, so whatever was planted for their moveSelect is
    // spent. Their damage mods are not — those are tested when the other side attacks.
    clearMods(mover, [STEP.MOVE_SELECT, STEP.DICE_ROLL])
    state.diceRerollRequest = null
    enterPhase("resolve")

    if (result.kind === "fail") {
      clearMods(opp, [STEP.DAMAGE])
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
    const ceIndex = result.kind === "chara" && result.ce
      ? (mv.chara || []).indexOf(result.ce)
      : null
    state.effectCtx = {
      moverKey, oppKey, moveId: mv.id, ceIndex,
      queue, cursor: 0,
      dmgToOpp: result.dmgInfo.raw, dmgToSelf: 0,
      charaShieldAsked: false
    }
    runEffects()
  }

  // Rebuild a working context from the plain data in state. The players are reactive objects
  // already living in state.players, so effects mutate the real thing; only the accumulators
  // need writing back (see runEffects).
  function hydrateEffectCtx() {
    const c = state.effectCtx
    if (!c) return null
    const mv = movesRef.value[c.moveId]
    const chara = (mv && mv.chara) || []
    return {
      ...c,
      mover: combatant(c.moverKey),
      opp: combatant(c.oppKey),
      mv,
      ce: c.ceIndex === null || c.ceIndex < 0 ? null : chara[c.ceIndex]
    }
  }

  /**
   * Push the effect queue forward until it either finishes or needs a player to answer.
   *
   * The one place the queue is driven, called the same way whether this is the first step of a
   * turn or the resumption of one that stopped for a prompt — `answer` is the only difference.
   */
  function runEffects(answer) {
    const ctx = hydrateEffectCtx()
    if (!ctx) return
    const ask = advanceEffectQueue(ctx, answer)
    // Position and running totals are the only things the queue mutates on the context itself;
    // everything else it touches is a player object, which is already shared state.
    Object.assign(state.effectCtx, {
      cursor: ctx.cursor, dmgToOpp: ctx.dmgToOpp, dmgToSelf: ctx.dmgToSelf,
      // Multi-throw effects keep a tally here between throws; plain data, so it survives.
      multi: ctx.multi || null
    })
    if (ask) {
      presentAsk(ask, ctx)
      return
    }
    // Not cleared yet: the damage step can still stop to ask about チルタリス's shield, and
    // that question has to be resumable too. proceedToAnimateWithCtx clears it once the
    // damage is actually going in.
    proceedToAnimateWithCtx(ctx)
  }

  // --- effect prompts (state.effectPrompt / phase: "effectPrompt") ---
  //
  // Online only: every one of these except bindWaza is fundamentally a request to read a die
  // that nobody's self-reporting can actually see any more once physical props are gone — see
  // beginCharaThrowTask()/beginEnergyThrowTask() below, which make each one a real synced throw
  // instead. Hotseat/solo have no real dice to read, so they keep the original self-report
  // overlay (state.effectPrompt) unconditionally; solo mode's own useSoloRun.js mirrors these
  // functions rather than sharing them (no online concept there at all).

  /**
   * Put a request from the effect queue to whoever can answer it.
   *
   * One function instead of the eight `showXPrompt`s it replaces, because they only ever
   * differed in two ways: which online path (if any) can answer it without asking a human,
   * and what the overlay needs on screen. Both are now decided from `ask.kind` in one place.
   *
   * Answering never calls back into anything. It goes through `submitEffectPrompt`, which
   * resumes the queue from the cursor in state — that is what makes a reload survivable.
   */
  function presentAsk(ask, ctx) {
    // Online: some of these are real synced throws rather than self-reported numbers, and one
    // is already answered by the roll that just happened.
    if (onlineModeActive) {
      if (ask.kind === 'diceNumber') {
        beginEnergyThrowTask(ctx.oppKey, ask.max / 2)
        return
      }
      // Every multi-throw effect now asks one throw at a time (see effectQueue), so the
      // online side only ever needs a single synced throw answered yes/no. The task's own
      // 'count' and 'repeat' modes are gone with them — the loop lives in the effect.
      if (ask.kind === 'charaDiceStep') {
        const roller = ask.enemy ? ctx.oppKey : ctx.moverKey
        beginCharaThrowTask(roller, ask.orientations, 'bool',
          { index: ask.index, total: ask.total, hits: ask.hits })
        return
      }
      if (ask.kind === 'charaDiceEnemyManual') {
        beginCharaThrowTask(ctx.oppKey, ask.orientations)
        return
      }
      if (ask.kind === 'charaDiceSelect' && ask.target === 'enemy') {
        beginCharaThrowTask(ctx.oppKey, ask.orientations, 'face')
        return
      }
    }
    // ヒトカゲ「フレアストーム」 and friends count energy that is already on the table — the
    // roll this move was paid with. Asking the player to recount it by hand would be asking
    // them to confirm something the app can see.
    if (ask.kind === 'eneCount' && state.energyRolledTypes) {
      submitEffectPrompt(state.energyRolledTypes.filter(ty => ty === ask.countedType).length)
      return
    }
    // Same shortcut for the character die the app threw itself.
    if (ask.kind === 'charaDiceSelect' && ask.target === 'self' && state.charaDieFace
        && ask.orientations.includes(state.charaDieFace)) {
      submitEffectPrompt(state.charaDieFace)
      return
    }

    // Everything else is a question for a person. The overlay wants the move and the two
    // players alongside the question itself; those are display data, re-derived here rather
    // than stored, so the saved context stays plain.
    const display = ask.kind === 'bindWaza'
      ? { picked: [] }
      : { mv: ctx.mv, dmgInfo: computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp), mover: ctx.mover, opp: ctx.opp }
    state.effectPrompt = { ...ask, ...display }
    enterPhase("effectPrompt")
  }

  // A yes/no about the die the attacker just physically threw. Same self-report shape as
  // showCharaDiceEnemyManualPrompt below, but about the *mover's* die and asked on behalf of
  // the defender's standing shield rather than the move being cast.
  function showCharaShieldPrompt(shield, ctx) {
    // When the app threw the die itself, the answer is already on screen — asking the player
    // to retype it would be asking them to confirm something the app knows better. Only the
    // physical-dice modes have a question to ask.
    if (state.charaDieFace) {
      submitEffectPrompt(shield.orientations.includes(state.charaDieFace))
      return
    }
    state.effectPrompt = {
      kind: "charaShield",
      orientations: shield.orientations,
      sourceName: shield.from,
      mv: ctx.mv,
      mover: ctx.mover,
      opp: ctx.opp
    }
    enterPhase("effectPrompt")
  }


  // --- online-only real "extra dice throw" tasks (state.charaThrowTask / state.energyThrowTask) ---
  //
  // Both follow the same shape as the main dice-overlay throw: whichever client owns
  // `rollerKey` runs the real physics and reports the settled face(s) + transforms; the other
  // side just replays the same transforms (see ExtraRollOverlay.vue). Only the host ever holds
  // a live `pendingXDone` callback — the guest's UI drives entirely off the synced task object.

  // One throw, answered and done. The task used to also carry 'count' and 'repeat' modes that
  // looped internally — those loops now live in the effect itself (see effectQueue's
  // charaDiceStep), which is what lets the position survive a reload instead of sitting in a
  // counter only this object knows about.
  //
  // `resultKind`: 'bool' (did it match) | 'face' (which orientation it landed on).
  function beginCharaThrowTask(rollerKey, orientations, resultKind = 'bool', progress = null) {
    // `progress` is only for the overlay to say "throw 2 of 3, 1 hit so far" — the count that
    // decides anything lives in the effect, not here.
    state.charaThrowTask = { rollerKey, orientations, resultKind, progress, lastFace: null, transforms: null }
    enterPhase("charaThrowTask")
  }

  // Every throw task exists to answer the effect queue, so it resolves the same way a typed
  // answer does — through submitEffectPrompt, which resumes from the cursor in state. There is
  // no stored callback to lose any more.
  function finishCharaThrowTask(result) {
    state.charaThrowTask = null
    enterPhase("resolve")
    submitEffectPrompt(result)
  }

  // Called (via dispatch, if the roller is the guest) once that client's own throw settles.
  function submitCharaThrowResult(face, transforms) {
    const t = state.charaThrowTask
    if (!t) return
    t.lastFace = face
    t.transforms = transforms
    finishCharaThrowTask(t.resultKind === 'face' ? face : t.orientations.includes(face))
  }

  function beginEnergyThrowTask(rollerKey, n) {
    state.energyThrowTask = { rollerKey, n, rolledTypes: null, transforms: null }
    enterPhase("energyThrowTask")
  }

  function submitEnergyThrowResult(rolledTypes, transforms) {
    const t = state.energyThrowTask
    if (!t) return
    const counts = {}
    rolledTypes.forEach(ty => { counts[ty] = (counts[ty] || 0) + 1 })
    const maxCount = Object.values(counts).reduce((m, c) => Math.max(m, c), 0)
    state.energyThrowTask = null
    enterPhase("resolve")
    submitEffectPrompt(maxCount)
  }

  // The answer goes back into the queue, which picks up from the cursor in state. No callback
  // is involved, which is exactly why a reload mid-prompt is recoverable.
  function submitEffectPrompt(value) {
    const wasShield = state.effectPrompt && state.effectPrompt.kind === "charaShield"
    state.effectPrompt = null
    enterPhase("resolve")
    if (wasShield) {
      // Not a queue answer — the queue is already finished. It decides whether the damage
      // lands, then the damage step runs again from the stored context.
      const ctx = hydrateEffectCtx()
      if (!ctx) return
      if (value) {
        ctx.dmgToOpp = 0
        state.effectCtx.dmgToOpp = 0
      }
      proceedToAnimateWithCtx(ctx)
      return
    }
    runEffects(value)
  }

  function pickBindWazaMove(mid) {
    const ep = state.effectPrompt
    if (!ep || ep.kind !== "bindWaza") return
    if (ep.picked.includes(mid)) return
    ep.picked.push(mid)
    if (ep.picked.length >= ep.count) {
      const picked = ep.picked.slice()
      state.effectPrompt = null
      enterPhase("resolve")
      runEffects(picked)
    }
  }

  // --- damage animation + turn handoff ---

  function playEffectOn(targetKey, type, dmg, cb, attackerKey, isMiss) {
    const isHeal = dmg < 0
    const doHit = () => {
      const target = combatant(targetKey)
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
      const attacker = combatant(attackerKey)
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
    combatant(key).frameOut = true
    setTimeout(cb, 1000)
  }

  function handOffTurn(oppKey) {
    state.turnPlayer = oppKey
    state.turnCount++
    state.selectedMove = null
    enterPhase("moveSelect", moveActorKey(oppKey))
    showTurnCutIn(oppKey)
  }

  // Online only: freezes the handoff on "resultConfirm" until oppKey's own client taps through
  // — see TurnResultOverlay.vue, which shows this turn's damage plus the mover's real dice
  // result (still readable off state.charaDieFace/energyRolledTypes/energySuccess; nothing else
  // touches those until clearDiceRoll() runs for the next pick).
  function showTurnResultConfirm(oppKey, mv, dmgToOpp) {
    state.turnResult = { oppKey, mvName: mv.name, mvType: mv.type, dmgToOpp }
    enterPhase("turnResultConfirm")
  }

  function confirmTurnResult() {
    const tr = state.turnResult
    if (!tr) return
    state.turnResult = null
    handOffTurn(tr.oppKey)
  }

  function showTurnCutIn(key) {
    const p = combatant(key)
    const isFirstTurn = state.turnCount === 0
    const energyCount = Math.max(0, (isFirstTurn ? 2 : 3) + modSum(p, STEP.DICE_ROLL, 'diceCount'))
    const hasChara = !modOf(p, STEP.DICE_ROLL, 'charaDieBlocked')
    state.turnCutIn = { key, hasChara, energyCount }
    setTimeout(() => {
      state.turnCutIn = null
    }, 1970)
  }

  // Asked only when ふわふわひこう is actually shielding the defender, and only when this
  // turn's damage would otherwise land — a 0-damage turn has nothing to cancel, and asking
  // anyway would be a prompt for no reason. Answering yes zeroes the damage and nothing else:
  // the card is explicit that other effects still apply, which is why this runs after the
  // effect queue rather than instead of it.
  function proceedToAnimateWithCtx(ctx) {
    const shield = modOf(ctx.opp, STEP.DAMAGE, 'nullifyIfCharaDice')
    if (shield && !ctx.charaShieldAsked && Math.max(ctx.dmgToOpp, 0) > 0) {
      // Recorded in state, not captured in a closure: the answer comes back through
      // submitEffectPrompt, which re-enters this function from the stored context.
      if (state.effectCtx) state.effectCtx.charaShieldAsked = true
      showCharaShieldPrompt(shield, ctx)
      return
    }
    state.effectCtx = null
    const { moverKey, mover, oppKey, opp, mv } = ctx
    const nullifyMod = modOf(opp, STEP.DAMAGE, 'damageSetTo')
    const dmgToOpp = nullifyMod
      ? Math.max(nullifyMod.value, 0)
      : Math.max(ctx.dmgToOpp, 0)
    const dmgToSelf = ctx.dmgToSelf

    playEffectOn(oppKey, mv.type, dmgToOpp, () => {
      opp.hp = Math.max(opp.hp - dmgToOpp, 0)
      // Recorded here rather than from dmgToOpp alone, because a shield can reduce it to
      // zero — "took no damage" has to mean what actually reached them.
      if (dmgToOpp > 0) opp.tookDamage = true

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
            enterPhase("win")
          })
          return
        }
        if (ctx.repeatValue) {
          state.repeatActive = true
          clearDiceRoll()
          enterPhase("diceRoll")
          return
        }
        state.repeatActive = false
        clearMods(opp, [STEP.DAMAGE])
        // Settle it for both sides: the attacker took nothing this turn unless their own
        // move hurt them, and the defender's flag was set when the damage landed.
        mover.committedTookDamage = mover.tookDamage
        opp.committedTookDamage = opp.tookDamage
        mover.tookDamage = false
        opp.tookDamage = false
        mover.committedLastMoveId = mover.lastMoveId
        mover.committedLastMoveFailed = mover.lastMoveFailed
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
    submitDiceReroll,
    clearDiceRerollRequest,
    resolveTurn,
    submitEffectPrompt,
    pickBindWazaMove,
    confirmTurnResult,
    submitCharaThrowResult,
    submitEnergyThrowResult,
    resetGame
  }
}
