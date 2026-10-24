// Returns the character's matching weakness entry ({ type, damage }) for an incoming move
// type, or null if the move doesn't hit a weakness. A character can carry more than one
// weakness, but a move only ever has one type, so at most one entry can match.
export function weaknessFor(character, moveType) {
  if (!character || !moveType) return null
  return (character.weaknesses || []).find(w => w.type === moveType) || null
}

export function isCharaColorConditionMet(effType, owner, opponent) {
  if (!effType || !owner || !opponent) return false
  if (effType === "DAMAGE_EXTRA_DICE_MISS_ENEMY") {
    return !!opponent.committedLastMoveFailed
  }
  if (effType === "DAMAGE_EXTRA_DICE_MISS_SELF") {
    return !!owner.committedLastMoveFailed
  }
  if (effType === "DAMAGE_EXTRA_IF_UNHURT") {
    return !owner.tookMoveDamage
  }
  const successSelfMatch = /^DAMAGE_EXTRA_DICE_SUCCESS_SELF_(.+)$/.exec(effType) || /^DAMAGE_SELF_DICE_SUCCESS_SELF_(.+)$/.exec(effType)
  if (successSelfMatch) {
    const wazaId = successSelfMatch[1]
    return owner.committedLastMoveId !== null && String(owner.committedLastMoveId) === String(wazaId) && !owner.committedLastMoveFailed
  }
  const vsTypeMatch = /^DAMAGE_EXTRA_VS_TYPE_(.+)$/.exec(effType)
  if (vsTypeMatch) {
    return !!(opponent.character && opponent.character.type === vsTypeMatch[1])
  }
  const hpLowMatch = /^DAMAGE_EXTRA_(\d+)HP_LOW$/.exec(effType)
  if (hpLowMatch) {
    const n = parseInt(hpLowMatch[1], 10)
    return owner.hp <= n
  }
  // Same HP gate, damage-reduction flavour — needed here too, or the row stays unhighlighted
  // while its condition is actually met and the player can't tell it's live.
  const reduceTakenHpLowMatch = /^MOD_REDUCE_TAKEN_(\d+)HP_LOW$/.exec(effType)
  if (reduceTakenHpLowMatch) {
    const n = parseInt(reduceTakenHpLowMatch[1], 10)
    return owner.hp <= n
  }
  return false
}

// NULLIFY_TAKEN_LE ("受けるダメージが N 以下なら、そのダメージを受けない"). Applied to the
// final figure — after weakness, damage modifiers and every character-die addition — since
// the card measures the damage actually taken. computeDisplayDamage deliberately leaves it
// out: the figure it shows is the floor a character-die bonus is added onto, and zeroing that
// floor would zero the bonus with it.
export function applyNullifyAtMost(target, dmg) {
  const limit = target.incomingDamageNullifyAtMost
  if (limit === null || limit === undefined) return dmg
  return dmg <= limit ? 0 : dmg
}

export function computeDisplayDamage(mv, mover, target, movesMap) {
  let base = mv.baseDamage
  let mode = "normal"
  if (mv.effectType === "DAMAGE_COPY_LAST") {
    const lastMv = target.lastMoveId ? movesMap[target.lastMoveId] : null
    base = lastMv ? lastMv.baseDamage * mv.effectValue : 0
  }
  const ignoreWeakness = mv.effectType === "SPECIAL_IGNORE_WEAKNESS"
  const hitWeakness = ignoreWeakness ? null : weaknessFor(target.character, mv.type)
  if (hitWeakness && base > 0) {
    base += hitWeakness.damage
    mode = "weak"
  }
  if (target.incomingDamageMod) {
    base += target.incomingDamageMod
    if (mode === "normal") mode = target.incomingDamageMod > 0 ? "up" : "down"
  }
  if (target.incomingDamageNullify !== null && target.incomingDamageNullify !== undefined) {
    base = target.incomingDamageNullify
    mode = base < mv.baseDamage ? "down" : base > mv.baseDamage ? "up" : "normal"
  }
  return {
    display: Math.max(base, 0),
    raw: base,
    orig: mv.baseDamage,
    mode
  }
}
