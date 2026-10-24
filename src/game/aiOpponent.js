// AI opponent generation for the solo tower-climb mode.
//
// Tier is driven by floor number and determines how many energy dice the AI has for
// the fight, which in turn caps which of its character's moves it can realistically
// afford (max affordable cost = tier * 2, since each energy die shows 1 pip on 4 faces
// and 2 pips on the other 2). The tier also determines how many of the affordable moves
// it "knows" for the fight, per the game-design rule:
//   tier 1 (1 die,  max cost 2): knows only the single highest-damage affordable move
//   tier 2 (2 dice, max cost 4): knows the highest-damage move + 1 other random move
//   tier 3 (3 dice, max cost 6): knows the highest-damage move, the lowest-damage move,
//                                 and 2 further random moves
export const ENERGY_PER_DIE_MAX = 2

export function energyDiceForTier(tier) {
  return tier
}

const HP_TIER_1 = 60
const HP_STEP = 30

export function hpForTier(tier) {
  return HP_TIER_1 + (tier - 1) * HP_STEP
}

export function maxAffordableCostForTier(tier) {
  return tier * ENERGY_PER_DIE_MAX
}

export function damageMultiplierForTier(tier) {
  return 1 + (tier - 1) * 0.2
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Picks which moves (by id) the AI knows for this fight, from `character.moves`.
export function buildAiMoveset(character, movesMap, tier) {
  const maxCost = maxAffordableCostForTier(tier)
  const pool = character.moves
    .map(id => movesMap[id])
    .filter(mv => mv && mv.cost.length > 0 && mv.cost.length <= maxCost)

  const usable = pool.length > 0 ? pool : character.moves.map(id => movesMap[id]).filter(Boolean)
  if (usable.length === 0) return []

  const byDamageDesc = [...usable].sort((a, b) => b.baseDamage - a.baseDamage)
  const highest = byDamageDesc[0]

  const known = [highest]
  if (tier === 1) {
    return dedupeIds(known)
  }

  if (tier === 2) {
    const rest = usable.filter(mv => mv.id !== highest.id)
    if (rest.length > 0) known.push(shuffle(rest)[0])
    return dedupeIds(known)
  }

  // tier 3
  const lowest = byDamageDesc[byDamageDesc.length - 1]
  if (lowest.id !== highest.id) known.push(lowest)
  const rest = shuffle(usable.filter(mv => mv.id !== highest.id && mv.id !== lowest.id))
  known.push(...rest.slice(0, 2))
  return dedupeIds(known)
}

function dedupeIds(moves) {
  const seen = new Set()
  const out = []
  moves.forEach(mv => {
    if (seen.has(mv.id)) return
    seen.add(mv.id)
    out.push(mv.id)
  })
  return out
}

// Effect values that aren't amounts of HP: a damage threshold, a count of rerolls, a flag.
// Scaling them like damage would turn "reroll 1 die" into "reroll 0" on the first floor that
// multiplies at all, so they pass through as printed.
const UNSCALED_EFFECT_TYPES = new Set([
  'NULLIFY_TAKEN_LE',
  'REROLL_DICE_ENEMY',
  'REROLL_CHARADICE_SELF',
  'SPECIAL_PICK_ENEMY_WAZA',
  'SPECIAL_SWAP_CHIP',
  'HEAL_SELF_FULL'
])

// Scales a move's numeric power fields by the floor damage multiplier, returning a
// standalone copy so the shared damage/effect-queue logic can operate on it unmodified.
export function scaleMoveForFloor(mv, multiplier) {
  const scale = n => Math.round((n * multiplier) / 5) * 5
  const scaleFor = (type, n) => (UNSCALED_EFFECT_TYPES.has(type) ? n : scale(n))
  return {
    ...mv,
    baseDamage: scale(mv.baseDamage),
    effectValue: mv.effectValue ? scaleFor(mv.effectType, mv.effectValue) : mv.effectValue,
    chara: mv.chara.map(ce => ({ ...ce, value: scaleFor(ce.type, ce.value) }))
  }
}

export function pickAiCharacter(characters) {
  return characters[Math.floor(Math.random() * characters.length)]
}

// Builds a full AI opponent descriptor for an explicit tier. Regular monster nodes on
// the map use tier = the current act number; boss nodes use tier = act + 1, so e.g. the
// Act 3 boss lands on tier 4 (hpForTier(4) = 150).
export function buildAiOpponentForTier(tier, characters, movesMap) {
  const character = pickAiCharacter(characters)
  const moveIds = buildAiMoveset(character, movesMap, tier)
  const multiplier = damageMultiplierForTier(tier)
  return {
    character,
    tier,
    energyDiceCount: energyDiceForTier(tier),
    hp: hpForTier(tier),
    moveIds,
    multiplier
  }
}
