import { clearMods, modOf, modSum, STEP } from '../game/turnMods'
import { reactive } from 'vue'
import { computeDisplayDamage as computeDisplayDamagePure, isCharaColorConditionMet } from '../game/damage'
import { advanceEffectQueue } from '../game/effectQueue'
import { buildAiOpponentForTier, scaleMoveForFloor, maxAffordableCostForTier } from '../game/aiOpponent'
import { generateActMap, reachableNodeIds as mapReachableNodeIds } from '../game/mapGen'
import { drawRandomEvent } from '../game/eventPool'

const STARTING_HP_FALLBACK = 100
const UPGRADE_HP_AMOUNT = 10
const UPGRADE_ATK_AMOUNT = 5
const UPGRADE_DEF_AMOUNT = 5
const STARTING_MOVE_COUNT = 2
const TOTAL_ACTS = 3

const LEVEL_UP_CHOICES = [
  { kind: "atk", amount: UPGRADE_ATK_AMOUNT },
  { kind: "def", amount: UPGRADE_DEF_AMOUNT },
  { kind: "hp", amount: UPGRADE_HP_AMOUNT }
]

function newCombatant() {
  return {
    character: null,
    moveIds: [],
    hp: 0,
    maxHp: 0,
    atkBonus: 0,
    defBonus: 0,
    energyDiceCount: 1,
    level: 1,
    winsSinceLevel: 0,
    lastMoveId: null,
    lastMoveFailed: false,
    committedLastMoveId: null,
    committedLastMoveFailed: false,
    // Everything an effect planted on this player for their next turn, tagged with the
    // step it changes — see game/turnMods.js. One list, one lifecycle, in place of a
    // field per effect each with its own clearing.
    mods: [],
    // Whether this side took move damage on the turn that just finished. `committed` is the
    // settled value a later turn reads, mirroring committedLastMoveFailed.
    tookDamage: false,
    committedTookDamage: false,
    diceModBadges: [],
    attackAnim: null,
    hitBlink: false,
    dmgOverlay: null,
    frameOut: false
  }
}

function freshRunState() {
  return {
    phase: "charSelect",
    act: 1,
    map: null,
    currentNodeId: null,
    reachableNodeIds: [],
    currentEvent: null,
    turn: "player",
    player: newCombatant(),
    ai: newCombatant(),
    selectedMove: null,
    effectPrompt: null,
    // The effect queue's position while one is running — see useBattleState's field of the
    // same name. Plain data so the turn can be resumed rather than held in a closure.
    effectCtx: null,
    repeatActive: false,
    upgradeChoices: null,
    learnMoveChoices: null,
    pendingChoiceQueue: [],
    pendingAfterQueue: null,
    gameOver: null,
    charSelectTemp: null
  }
}

const state = reactive(freshRunState())

export function useSoloRun(charactersRef, movesRef) {
  function resetRun() {
    Object.assign(state, freshRunState())
  }

  function opponentOf(who) {
    return who === "player" ? "ai" : "player"
  }

  function combatant(who) {
    return state[who]
  }

  function hpBarClass(c) {
    if (c.maxHp <= 0) return ""
    const ratio = c.hp / c.maxHp
    if (ratio <= .2) return "crit"
    if (ratio <= .5) return "low"
    return ""
  }

  function computeDisplayDamage(mv, mover, target) {
    return computeDisplayDamagePure(mv, mover, target, movesRef.value)
  }

  // --- character select ---

  function startingAffordableMoveIds(character) {
    const maxCost = maxAffordableCostForTier(1)
    return character.moves.filter(id => {
      const mv = movesRef.value[id]
      return mv && mv.cost.length > 0 && mv.cost.length <= maxCost
    })
  }

  function selectCharacter(character) {
    state.charSelectTemp = { character, moveIds: [] }
  }

  function toggleStartingMove(moveId) {
    const tmp = state.charSelectTemp
    if (!tmp) return
    if (tmp.moveIds.includes(moveId)) {
      tmp.moveIds = tmp.moveIds.filter(id => id !== moveId)
    } else if (tmp.moveIds.length < STARTING_MOVE_COUNT) {
      tmp.moveIds.push(moveId)
    }
  }

  function confirmStartingSetup() {
    const tmp = state.charSelectTemp
    if (!tmp || tmp.moveIds.length !== STARTING_MOVE_COUNT) return
    const p = state.player
    p.character = tmp.character
    p.moveIds = tmp.moveIds.slice()
    p.maxHp = tmp.character.hp || STARTING_HP_FALLBACK
    p.hp = p.maxHp
    p.energyDiceCount = 1
    p.level = 1
    p.winsSinceLevel = 0
    state.charSelectTemp = null
    startAct(1)
  }

  // --- act / map / node navigation ---

  function startAct(actNumber) {
    state.act = actNumber
    state.map = generateActMap()
    state.currentNodeId = null
    state.reachableNodeIds = state.map.startNodeIds
    state.currentEvent = null
    state.phase = "map"
  }

  function pickRandomCharacterName() {
    const list = charactersRef.value
    return list[Math.floor(Math.random() * list.length)].name
  }

  function resetCombatantForFight(c) {
    c.lastMoveId = null
    c.lastMoveFailed = false
    c.committedLastMoveId = null
    c.committedLastMoveFailed = false
    clearMods(c, [STEP.DAMAGE])
    c.tookDamage = false
    c.committedTookDamage = false
    c.diceModBadges = []
    c.attackAnim = null
    c.hitBlink = false
    c.dmgOverlay = null
    c.frameOut = false
  }

  function startCombat(tier) {
    const ai = state.ai
    const opp = buildAiOpponentForTier(tier, charactersRef.value, movesRef.value)
    ai.character = opp.character
    ai.moveIds = opp.moveIds
    ai.maxHp = opp.hp
    ai.hp = ai.maxHp
    ai.energyDiceCount = opp.energyDiceCount
    ai.tier = opp.tier
    ai.multiplier = opp.multiplier
    resetCombatantForFight(ai)
    resetCombatantForFight(state.player)

    state.turn = "player"
    state.selectedMove = null
    state.upgradeChoices = null
    state.phase = "moveSelect"
  }

  function enterNode(nodeId) {
    if (!state.reachableNodeIds.includes(nodeId)) return
    const node = state.map.nodes[nodeId]
    state.currentNodeId = nodeId

    if (node.type === "monster") {
      startCombat(state.act)
    } else if (node.type === "boss") {
      startCombat(state.act + 1)
    } else if (node.type === "event") {
      const ev = drawRandomEvent()
      const characterName = pickRandomCharacterName()
      applyEventEffect(ev)
      state.currentEvent = { ...ev, characterName }
      state.phase = "event"
    } else if (node.type === "campfire") {
      state.player.hp = state.player.maxHp
      state.phase = "campfire"
    }
  }

  function applyEventEffect(ev) {
    const p = state.player
    if (ev.effectKind === "heal") {
      p.hp = Math.min(p.hp + ev.amount, p.maxHp)
    } else if (ev.effectKind === "atk") {
      p.atkBonus += ev.amount
    } else if (ev.effectKind === "def") {
      p.defBonus += ev.amount
    } else if (ev.effectKind === "maxHp") {
      p.maxHp += ev.amount
      p.hp = Math.min(p.hp + ev.amount, p.maxHp)
    }
  }

  function returnToMap() {
    state.currentEvent = null
    state.reachableNodeIds = mapReachableNodeIds(state.map, state.currentNodeId)
    state.phase = "map"
  }

  // --- move selection / AI move choice ---

  // The two standard restrictions, straight from the tabletop rules: a move can't be used
  // twice in a row, and a sealed move can't be used at all. Neither is relaxed here — an
  // empty result genuinely means "no legal move", which the caller resolves by skipping the
  // turn (SoloMoveSelect.vue for the player, `aiTakeTurn` below for the AI) rather than by
  // handing back an illegal move. With 4 moves these two restrictions can never lock out
  // every option, but a tower run starts at 2 moves, where they can.
  function availableMoveIds(who) {
    const c = state[who]
    const ban = modOf(c, STEP.MOVE_SELECT, 'banMoves')
    return c.moveIds.filter(mid => mid !== c.committedLastMoveId && !(ban && ban.ids.includes(mid)))
  }

  function pickMove(mid) {
    state.selectedMove = mid
    // Both sides' dice are physically rolled by the player, who self-reports success,
    // a character-die effect, or failure directly — same as duel mode, for both turns.
    state.phase = "diceSuccess"
  }

  function aiTakeTurn() {
    const ai = state.ai
    const aiBan = modOf(ai, STEP.MOVE_SELECT, 'banMoves')
    const notSealed = ai.moveIds.filter(mid => !(aiBan && aiBan.ids.includes(mid)))
    if (notSealed.length === 0) {
      // Every move the AI knows is actually sealed — it truly has nothing it can do.
      state.phase = "aiSkip"
      return
    }
    // The AI alone gets the no-repeat rule relaxed, and only as a last resort. A tier-1
    // opponent knows exactly 1 move (see buildAiMoveset), so enforcing "no repeats" strictly
    // would make it skip every turn after its first — the run would stop being a fight. The
    // player never needs this: they always start with 2 moves, so an empty result there is a
    // real dead end and gets a skip instead (see SoloMoveSelect.vue).
    const pool = notSealed.filter(mid => mid !== ai.committedLastMoveId)
    const usable = pool.length > 0 ? pool : notSealed
    const mid = usable[Math.floor(Math.random() * usable.length)]
    pickMove(mid)
  }

  function skipAiTurn() {
    const ai = state.ai
    ai.committedLastMoveId = null
    ai.committedLastMoveFailed = false

    // resolveTurn never runs for a skipped turn, so the modifiers planted for it have to be
    // spent here or they would carry into the next one. (The old two-field version was worse
    // than that: the live seal got re-committed after every later turn, so it never expired.)
    clearMods(ai, [STEP.MOVE_SELECT])
    state.turn = "player"
    state.selectedMove = null
    state.phase = "moveSelect"
  }

  // Mirror of skipAiTurn for the player, for when every move they know is either sealed or
  // the one they just used. Without this the run would simply dead-end: the move grid would
  // sit there with all 4 cards disabled and no way to advance the turn.
  function skipPlayerTurn() {
    const p = state.player
    p.committedLastMoveId = null
    p.committedLastMoveFailed = false

    // Same reasoning as skipAiTurn.
    clearMods(p, [STEP.MOVE_SELECT])
    state.turn = "ai"
    state.selectedMove = null
    state.phase = "moveSelect"
    aiTakeTurn()
  }

  function backToMoveSelect() {
    if (state.repeatActive) return
    state.selectedMove = null
    state.phase = "moveSelect"
  }

  function moveForTurn() {
    const raw = movesRef.value[state.selectedMove]
    if (state.turn === "ai" && state.ai.multiplier) {
      return scaleMoveForFloor(raw, state.ai.multiplier)
    }
    return raw
  }

  // --- resolution (shared effect-queue engine) ---

  function resolveTurn(result) {
    const moverKey = state.turn
    const mover = state[moverKey]
    const oppKey = opponentOf(moverKey)
    const opp = state[oppKey]
    const mv = moveForTurn()
    mover.lastMoveId = state.selectedMove
    mover.lastMoveFailed = result.kind === "fail"
    mover.diceModBadges = []
    // Consumed by the turn they applied to, alongside every other next-turn modifier.
    // The mover has now picked and acted, so whatever was planted for their moveSelect is
    // spent. Their damage mods are not — those are tested when the other side attacks.
    clearMods(mover, [STEP.MOVE_SELECT, STEP.DICE_ROLL])
    state.phase = "resolve"

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
    const dmgInfo = result.dmgInfo || computeDisplayDamage(mv, mover, opp)
    const ceIndex = result.kind === "chara" && result.ce ? (mv.chara || []).indexOf(result.ce) : null
    state.effectCtx = {
      moverKey, oppKey, moveId: mv.id, ceIndex,
      queue, cursor: 0,
      dmgToOpp: dmgInfo.raw + (mover.atkBonus || 0), dmgToSelf: 0,
      charaShieldAsked: false
    }
    runEffects()
  }

  // 跟對戰模式同一套流程（見 useBattleState：為什麼這些不放在 closure 裡），但**狀態的
  // 形狀不一樣**：那邊兩位對戰者放在 state.players 這個表裡，這邊是 state.player 與
  // state.ai 兩個獨立的鍵。所以這裡要用 combatant()，不能照抄 state.players[key] ——
  // 那會讀到 undefined，而且要等效果佇列真的跑起來（也就是玩家點下招式之後）才會炸。
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

  function runEffects(answer) {
    const ctx = hydrateEffectCtx()
    if (!ctx) return
    const ask = advanceEffectQueue(ctx, answer)
    Object.assign(state.effectCtx, {
      cursor: ctx.cursor, dmgToOpp: ctx.dmgToOpp, dmgToSelf: ctx.dmgToSelf,
      // Multi-throw effects keep a tally here between throws; plain data, so it survives.
      multi: ctx.multi || null
    })
    if (ask) {
      presentAsk(ask, ctx)
      return
    }
    proceedToAnimateWithCtx(ctx)
  }

  // Solo has no online paths and no second device, so every request is a question for the one
  // player at the table.
  function presentAsk(ask, ctx) {
    if (ask.kind === 'charaDiceSelect' && ask.target === 'self' && state.charaDieFace
        && ask.orientations.includes(state.charaDieFace)) {
      submitEffectPrompt(state.charaDieFace)
      return
    }
    const display = ask.kind === 'bindWaza'
      ? { picked: [] }
      : { mv: ctx.mv, dmgInfo: computeDisplayDamage(ctx.mv, ctx.mover, ctx.opp), mover: ctx.mover, opp: ctx.opp }
    state.effectPrompt = { ...ask, ...display }
    state.phase = "effectPrompt"
  }

  // --- effect prompts (same shapes as duel mode) ---

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
    state.phase = "effectPrompt"
  }

  function submitEffectPrompt(value) {
    const wasShield = state.effectPrompt && state.effectPrompt.kind === "charaShield"
    state.effectPrompt = null
    state.phase = "resolve"
    if (wasShield) {
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
      state.phase = "resolve"
      runEffects(picked)
    }
  }

  // --- success-column choice (mirrors duel's DiceOverlay success buttons) ---

  function chooseSuccessOnly() {
    const mover = state[state.turn]
    const opp = state[opponentOf(state.turn)]
    const mv = moveForTurn()
    const dmgInfo = computeDisplayDamage(mv, mover, opp)
    resolveTurn({ kind: "success", dmgInfo })
  }

  function chooseCharaEffect(ce) {
    const mover = state[state.turn]
    const opp = state[opponentOf(state.turn)]
    const mv = moveForTurn()
    const dmgInfo = computeDisplayDamage(mv, mover, opp)
    resolveTurn({ kind: "chara", ce, dmgInfo })
  }

  // Only reachable on the player's own turn — the player self-reports a failed energy
  // roll the same way duel mode does, since they can judge their own dice against their
  // own move's cost without any help from the app.
  function chooseFail() {
    resolveTurn({ kind: "fail" })
  }

  // --- animation + turn handoff ---

  function playEffectOn(targetKey, dmg, cb, attackerKey, isMiss) {
    const isHeal = dmg < 0
    const doHit = () => {
      const target = state[targetKey]
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
      const attacker = state[attackerKey]
      attacker.attackAnim = attackerKey === "player" ? "atk-right" : "atk-left"
      setTimeout(() => {
        attacker.attackAnim = null
        doHit()
      }, 550)
    } else {
      doHit()
    }
  }

  function frameOutDefeated(key, cb) {
    state[key].frameOut = true
    setTimeout(cb, 1000)
  }

  // Asked only when ふわふわひこう is actually shielding the defender, and only when this
  // turn's damage would otherwise land — a 0-damage turn has nothing to cancel, and asking
  // anyway would be a prompt for no reason. Answering yes zeroes the damage and nothing else:
  // the card is explicit that other effects still apply, which is why this runs after the
  // effect queue rather than instead of it.
  function proceedToAnimateWithCtx(ctx) {
    const shield = modOf(ctx.opp, STEP.DAMAGE, 'nullifyIfCharaDice')
    if (shield && !ctx.charaShieldAsked && Math.max(ctx.dmgToOpp, 0) > 0) {
      if (state.effectCtx) state.effectCtx.charaShieldAsked = true
      showCharaShieldPrompt(shield, ctx)
      return
    }
    state.effectCtx = null
    const { moverKey, mover, oppKey, opp, mv } = ctx
    let nullifyMod = modOf(opp, STEP.DAMAGE, 'damageSetTo')
    let dmgToOpp = nullifyMod
      ? Math.max(nullifyMod.value, 0)
      : Math.max(ctx.dmgToOpp, 0)
    dmgToOpp = Math.max(dmgToOpp - (opp.defBonus || 0), 0)
    const dmgToSelf = ctx.dmgToSelf

    playEffectOn(oppKey, dmgToOpp, () => {
      opp.hp = Math.max(opp.hp - dmgToOpp, 0)
      // Recorded here rather than from dmgToOpp alone, because a shield can reduce it to
      // zero — "took no damage" has to mean what actually reached them.
      if (dmgToOpp > 0) opp.tookDamage = true

      const finishSelf = () => {
        if (opp.hp <= 0 || mover.hp <= 0) {
          const deadKeys = []
          if (opp.hp <= 0) deadKeys.push(oppKey)
          if (mover.hp <= 0) deadKeys.push(moverKey)
          Promise.all(deadKeys.map(k => new Promise(res => frameOutDefeated(k, res)))).then(() => {
            if (state.player.hp <= 0) {
              state.gameOver = { act: state.act }
              state.phase = "gameOver"
            } else {
              onCombatWon()
            }
          })
          return
        }
        if (ctx.repeatValue) {
          state.repeatActive = true
          state.phase = "diceSuccess"
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
        state.turn = oppKey
        state.selectedMove = null
        state.phase = "moveSelect"
        if (state.turn === "ai") aiTakeTurn()
      }

      if (dmgToSelf !== 0) {
        setTimeout(() => {
          playEffectOn(moverKey, dmgToSelf, () => {
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

  // --- post-combat rewards: win-count level-up (monster nodes) or move+die (boss nodes) ---

  function buildLearnMoveChoices() {
    const p = state.player
    const maxCost = maxAffordableCostForTier(p.energyDiceCount || 1)
    return p.character.moves.filter(id => {
      if (p.moveIds.includes(id)) return false
      const mv = movesRef.value[id]
      return mv && mv.cost.length > 0 && mv.cost.length <= maxCost
    })
  }

  function onCombatWon() {
    const node = state.map.nodes[state.currentNodeId]
    const isBoss = node.type === "boss"
    const p = state.player
    const queue = []

    if (isBoss) {
      p.energyDiceCount += 1
      if (p.moveIds.length < 4 && buildLearnMoveChoices().length > 0) {
        queue.push({ kind: "learnMove" })
      }
    } else {
      p.winsSinceLevel += 1
      if (p.winsSinceLevel >= p.level) {
        p.winsSinceLevel = 0
        p.level += 1
        queue.push({ kind: "levelUp" })
      }
    }

    state.pendingChoiceQueue = queue
    state.pendingAfterQueue = isBoss ? "bossAdvance" : "mapReturn"
    advanceChoiceQueue()
  }

  function advanceChoiceQueue() {
    if (state.pendingChoiceQueue.length === 0) {
      finishPendingResolution()
      return
    }
    const next = state.pendingChoiceQueue.shift()
    if (next.kind === "levelUp") {
      state.upgradeChoices = LEVEL_UP_CHOICES
      state.phase = "floorClear"
    } else if (next.kind === "learnMove") {
      state.learnMoveChoices = buildLearnMoveChoices()
      state.phase = "learnMove"
    }
  }

  function finishPendingResolution() {
    const after = state.pendingAfterQueue
    state.pendingAfterQueue = null
    if (after === "bossAdvance") {
      if (state.act >= TOTAL_ACTS) {
        state.phase = "victory"
      } else {
        startAct(state.act + 1)
      }
    } else {
      returnToMap()
    }
  }

  function applyLevelUpChoice(choice) {
    const p = state.player
    if (choice.kind === "hp") {
      p.maxHp += choice.amount
    } else if (choice.kind === "atk") {
      p.atkBonus += choice.amount
    } else if (choice.kind === "def") {
      p.defBonus += choice.amount
    }
    // Leveling up always tops off HP, regardless of which stat was chosen.
    p.hp = p.maxHp
    state.upgradeChoices = null
    advanceChoiceQueue()
  }

  function learnBonusMove(mid) {
    const p = state.player
    if (!p.moveIds.includes(mid) && p.moveIds.length < 4) {
      p.moveIds.push(mid)
    }
    state.learnMoveChoices = null
    advanceChoiceQueue()
  }

  return {
    state,
    combatant,
    opponentOf,
    hpBarClass,
    computeDisplayDamage,
    isCharaColorConditionMet,
    selectCharacter,
    toggleStartingMove,
    startingAffordableMoveIds,
    confirmStartingSetup,
    enterNode,
    returnToMap,
    availableMoveIds,
    pickMove,
    skipAiTurn,
    skipPlayerTurn,
    backToMoveSelect,
    moveForTurn,
    submitEffectPrompt,
    pickBindWazaMove,
    chooseSuccessOnly,
    chooseCharaEffect,
    chooseFail,
    applyLevelUpChoice,
    learnBonusMove,
    resetRun
  }
}
