export function pushDiceModBadge(player, name, type) {
  if (!player.diceModBadges) player.diceModBadges = []
  if (player.diceModBadges.some(b => b.name === name)) return
  player.diceModBadges.push({ name, type })
}

// Whether a character-die effect row is still reachable while `fix` is in force.
//
// `fix.value === 1` pins the die TO the listed orientations, so a row is available only if it
// covers at least one of them; any other value bars those orientations instead, leaving a row
// available as long as it has some orientation outside the barred set.
export function charaDiceOrientationAllowed(ceOrientations, fix) {
  if (!fix) return true
  const inFix = o => fix.orientations.includes(o)
  if (fix.value === 1) return ceOrientations.some(inFix)
  return ceOrientations.some(o => !inFix(o))
}

// The last effect type that reached the default branch — i.e. that no handler claimed. Read
// straight after a run to tell "no handler exists" apart from "a handler ran but its condition
// was false", which is what makes `isEffectTypeHandled` below exact rather than heuristic.
let lastUnhandledType = null

// Generic resolver for a move's effect + character-die effect queue. Shared between
// the 2P duel and the solo run mode: both build a `ctx` ({moverKey?, mover, oppKey?, opp, mv,
// dmgToOpp, dmgToSelf}) and a `hooks` object that knows how to surface the handful of
// effect types that need extra player input (dice prompts, move-binding picks, etc.) in
// that mode's own UI/state.
export function runEffectQueue(queue, idx, ctx, hooks, done) {
  if (idx >= queue.length) {
    done()
    return
  }
  const eff = queue[idx]
  const next = () => runEffectQueue(queue, idx + 1, ctx, hooks, done)

  const enemyDiceMatch = /^DAMAGE_BY_ENEMY_(\d+)DICE$/.exec(eff.type)
  if (enemyDiceMatch) {
    const n = parseInt(enemyDiceMatch[1], 10)
    hooks.showDicePrompt(n, eff.value, ctx, num => {
      ctx.dmgToOpp += num * eff.value
      next()
    })
    return
  }
  const charaDiceMatch = /^DAMAGE_EXTRA_(\d+)CHARADICE$/.exec(eff.type)
  if (charaDiceMatch) {
    const n = parseInt(charaDiceMatch[1], 10)
    hooks.showCharaDiceCountPrompt(n, eff.value, ctx, successCount => {
      ctx.dmgToOpp += successCount * eff.value
      next()
    })
    return
  }
  const hpLowMatch = /^DAMAGE_EXTRA_(\d+)HP_LOW$/.exec(eff.type)
  if (hpLowMatch) {
    const n = parseInt(hpLowMatch[1], 10)
    if (ctx.mover.hp <= n) ctx.dmgToOpp += eff.value
    next()
    return
  }
  // Same HP gate as above, but granting damage reduction instead of extra damage. It needs its
  // own arm rather than riding on `case "MOD_REDUCE_TAKEN"`: that case matches the whole string,
  // so the `_80HP_LOW` suffix fell through to default and the effect was silently dropped.
  const reduceTakenHpLowMatch = /^MOD_REDUCE_TAKEN_(\d+)HP_LOW$/.exec(eff.type)
  if (reduceTakenHpLowMatch) {
    const n = parseInt(reduceTakenHpLowMatch[1], 10)
    if (ctx.mover.hp <= n) {
      ctx.mover.incomingDamageMod = (ctx.mover.incomingDamageMod || 0) + eff.value
    }
    next()
    return
  }
  const charaDiceEnemyMatch = /^DAMAGE_EXTRA_CHARADICE_ENEMY_(.+)$/.exec(eff.type)
  if (charaDiceEnemyMatch) {
    const orientations = charaDiceEnemyMatch[1].split(',').map(s => s.trim()).filter(s => s !== "")
    hooks.showCharaDiceEnemyManualPrompt(orientations, eff.value, ctx, success => {
      if (success) ctx.dmgToOpp += eff.value
      next()
    })
    return
  }
  // The opponent rolls their character die n times and every hit on one of the listed
  // orientations adds damage. Distinct from DAMAGE_EXTRA_CHARADICE_ENEMY_ above, which is a
  // single roll answered yes/no — here the answer is a count, so it needs its own prompt.
  const charaDiceComboEnemyMatch = /^DAMAGE_EXTRA_CHARADICE_(\d+)COMBO_ENEMY_(.+)$/.exec(eff.type)
  if (charaDiceComboEnemyMatch) {
    const n = parseInt(charaDiceComboEnemyMatch[1], 10)
    const orientations = charaDiceComboEnemyMatch[2].split(',').map(s => s.trim()).filter(s => s !== "")
    hooks.showCharaDiceComboEnemyPrompt(n, orientations, eff.value, ctx, successCount => {
      ctx.dmgToOpp += successCount * eff.value
      next()
    })
    return
  }
  // Like FIX_CHARADICE_SELF_ below, except the player chooses which of the listed orientations
  // to pin to — it's whichever one this move's own character die actually landed on, which only
  // the player at the table can see.
  const fixCharaSelectSelfMatch = /^FIX_CHARADICE_SELECT_SELF_(.+)$/.exec(eff.type)
  if (fixCharaSelectSelfMatch) {
    const orientations = fixCharaSelectSelfMatch[1].split(',').map(s => s.trim()).filter(s => s !== "")
    hooks.showCharaDiceSelectPrompt(orientations, eff.value, ctx, 'self', ori => {
      ctx.mover.fixCharaDice = { value: eff.value, orientations: [ori] }
      pushDiceModBadge(ctx.mover, ctx.mv.name, ctx.mv.type)
      next()
    })
    return
  }
  // Same, aimed at the opponent. Unused by the current roster, present so the pair stays whole.
  const fixCharaSelectEnemyMatch = /^FIX_CHARADICE_SELECT_ENEMY_(.+)$/.exec(eff.type)
  if (fixCharaSelectEnemyMatch) {
    const orientations = fixCharaSelectEnemyMatch[1].split(',').map(s => s.trim()).filter(s => s !== "")
    hooks.showCharaDiceSelectPrompt(orientations, eff.value, ctx, 'enemy', ori => {
      ctx.opp.fixCharaDice = { value: eff.value, orientations: [ori] }
      pushDiceModBadge(ctx.opp, ctx.mv.name, ctx.mv.type)
      next()
    })
    return
  }
  // Bonus damage conditional on the opponent's own species type (not their move's type) —
  // e.g. ムーンフォース's "opponent is Dragon-type" clause. The condition is knowable the
  // instant a move is cast (ctx.opp.character is already picked), unlike the die-based
  // effects above, so it needs no prompt and resolves inline.
  const vsTypeMatch = /^DAMAGE_EXTRA_VS_TYPE_(.+)$/.exec(eff.type)
  if (vsTypeMatch) {
    if (ctx.opp.character && ctx.opp.character.type === vsTypeMatch[1]) {
      ctx.dmgToOpp += eff.value
    }
    next()
    return
  }

  // Pins a player's character die for their next turn: rows whose orientations fall outside the
  // fixed set become unselectable (see charaDiceOrientationAllowed). Mirrors `charaDiceBlocked`
  // in lifecycle — set here, consumed next turn, cleared when that turn resolves.
  const fixCharaDiceEnemyMatch = /^FIX_CHARADICE_ENEMY_(.+)$/.exec(eff.type)
  if (fixCharaDiceEnemyMatch) {
    const orientations = fixCharaDiceEnemyMatch[1].split(',').map(s => s.trim()).filter(s => s !== "")
    ctx.opp.fixCharaDice = { value: eff.value, orientations }
    pushDiceModBadge(ctx.opp, ctx.mv.name, ctx.mv.type)
    next()
    return
  }
  // No move uses this yet, but it's the self-targeting half of the pair above — handled now so a
  // future roster addition doesn't repeat the silent-drop bug.
  const fixCharaDiceSelfMatch = /^FIX_CHARADICE_SELF_(.+)$/.exec(eff.type)
  if (fixCharaDiceSelfMatch) {
    const orientations = fixCharaDiceSelfMatch[1].split(',').map(s => s.trim()).filter(s => s !== "")
    ctx.mover.fixCharaDice = { value: eff.value, orientations }
    pushDiceModBadge(ctx.mover, ctx.mv.name, ctx.mv.type)
    next()
    return
  }

  switch (eff.type) {
    case "DAMAGE_EXTRA":
      ctx.dmgToOpp += eff.value
      next()
      break
    case "SPECIAL_IGNORE_WEAKNESS":
      next()
      break
    case "MOD_REDUCE_TAKEN":
      ctx.mover.incomingDamageMod = (ctx.mover.incomingDamageMod || 0) + eff.value
      next()
      break
    case "MOD_NULLIFY_TAKEN":
      ctx.mover.incomingDamageNullify = eff.value
      next()
      break
    case "DAMAGE_SELF":
      ctx.dmgToSelf += eff.value
      next()
      break
    case "MOD_DICE_ENEMY":
      ctx.opp.diceMod = (ctx.opp.diceMod || 0) + eff.value
      pushDiceModBadge(ctx.opp, ctx.mv.name, ctx.mv.type)
      next()
      break
    case "MOD_CHARADICE_ENEMY":
      ctx.opp.charaDiceBlocked = true
      pushDiceModBadge(ctx.opp, ctx.mv.name, ctx.mv.type)
      next()
      break
    case "MOD_DICE-CHARADICE_ENEMY":
      ctx.opp.charaDiceBlocked = true
      ctx.opp.diceMod = (ctx.opp.diceMod || 0) + eff.value
      pushDiceModBadge(ctx.opp, ctx.mv.name, ctx.mv.type)
      next()
      break
    case "SPECIAL_REPEAT":
      ctx.repeatValue = eff.value
      next()
      break
    case "MOD_DICE_SELF":
      ctx.mover.diceMod = (ctx.mover.diceMod || 0) + eff.value
      pushDiceModBadge(ctx.mover, ctx.mv.name, ctx.mv.type)
      next()
      break
    case "DAMAGE_MULTIPLY":
      ctx.dmgToOpp = ctx.dmgToOpp * eff.value
      next()
      break
    case "DAMAGE_COPY_LAST":
      next()
      break
    case "DAMAGE_EXTRA_CHARADICE_REPEAT":
      hooks.showCharaDiceRepeatPrompt(eff.value, ctx, successCount => {
        ctx.dmgToOpp += successCount * eff.value
        next()
      })
      return
    case "SPECIAL_BIND_WAZA":
      hooks.showBindWazaPrompt(ctx.oppKey, eff.value, pickedIds => {
        ctx.opp.bannedMoveIds = pickedIds
        ctx.opp.bannedMoveSourceName = ctx.mv.name
        next()
      })
      return
    case "DAMAGE_EXTRA_ENE":
      hooks.showEneCountPrompt(eff.value, ctx, count => {
        ctx.dmgToOpp += count * eff.value
        next()
      })
      return
    case "MOD_DICE_STEAL":
      ctx.opp.diceMod = (ctx.opp.diceMod || 0) - eff.value
      pushDiceModBadge(ctx.opp, ctx.mv.name, ctx.mv.type)
      ctx.mover.diceMod = (ctx.mover.diceMod || 0) + eff.value
      pushDiceModBadge(ctx.mover, ctx.mv.name, ctx.mv.type)
      next()
      break
    case "DAMAGE_EXTRA_DICE_MISS_ENEMY":
      if (ctx.opp.committedLastMoveFailed) ctx.dmgToOpp += eff.value
      next()
      break
    case "DAMAGE_EXTRA_DICE_MISS_SELF":
      if (ctx.mover.committedLastMoveFailed) ctx.dmgToOpp += eff.value
      next()
      break
    default: {
      const successSelfDmgMatch = /^DAMAGE_EXTRA_DICE_SUCCESS_SELF_(.+)$/.exec(eff.type)
      if (successSelfDmgMatch) {
        const wazaId = successSelfDmgMatch[1]
        if (ctx.mover.committedLastMoveId !== null && String(ctx.mover.committedLastMoveId) === String(wazaId) && !ctx.mover.committedLastMoveFailed) {
          ctx.dmgToOpp += eff.value
        }
        next()
        break
      }
      const successSelfSelfMatch = /^DAMAGE_SELF_DICE_SUCCESS_SELF_(.+)$/.exec(eff.type)
      if (successSelfSelfMatch) {
        const wazaId = successSelfSelfMatch[1]
        if (ctx.mover.committedLastMoveId !== null && String(ctx.mover.committedLastMoveId) === String(wazaId) && !ctx.mover.committedLastMoveFailed) {
          ctx.dmgToSelf += eff.value
        }
        next()
        break
      }
      // Nothing claimed this type. The move still lands and deals its damage, so an unhandled
      // effect is invisible in play — which is how four of the 07-09 effects shipped doing
      // nothing at all. Record it so checkEffectCoverage can report it up front, and say so in
      // dev rather than letting it pass in silence.
      lastUnhandledType = eff.type
      if (import.meta.env?.DEV) {
        console.warn(`[effectQueue] 未實作的效果類型「${eff.type}」，此招的附加效果不會發生`)
      }
      next()
    }
  }
}

// Whether any handler claims `type`, decided by actually running the dispatcher and seeing
// whether it reached the default branch. Running it is what makes this exact: a static list of
// patterns kept alongside the dispatch would drift from it, and probing for an observable change
// instead would report a handler whose condition happened to be false as missing.
export function isEffectTypeHandled(type) {
  const probeCtx = {
    moverKey: 'a', oppKey: 'b',
    mover: { hp: 0, diceModBadges: [], moves: [] },
    opp: { hp: 0, diceModBadges: [], moves: [] },
    mv: { name: '', type: '', baseDamage: 0 },
    dmgToOpp: 0, dmgToSelf: 0
  }
  // Hooks that never invoke their callback: reaching one already proves the type was claimed,
  // and continuing the queue from here would serve no purpose.
  const probeHooks = new Proxy({}, { get: () => () => {} })
  lastUnhandledType = null
  try {
    runEffectQueue([{ type, value: 0 }], 0, probeCtx, probeHooks, () => {})
  } catch {
    // A handler that threw on the stub context is still a handler.
    return true
  }
  return lastUnhandledType !== type
}
