// How each character plays, as six ratings.
//
// These are judgements, not measurements. Nothing in the game data says a character is
// "controlling" — that comes from reading their moves and dice together, and reasonable people
// will disagree. Kept in one hand-edited table rather than derived, because a derivation would
// dress an opinion up as a calculation.
//
// Clockwise from the top of the chart. The order is the chart's shape, so changing it reshapes
// every character's silhouette — it is not an arbitrary list.
export const TRAIT_AXES = ['attack', 'defense', 'stability', 'burst', 'control', 'ease']

export const TRAIT_MIN = 0
export const TRAIT_MAX = 5
export const TRAIT_STEP = 0.5

// Keyed by character id, not by name. `characters` carries the name already translated into
// the reader's language, so a name key would resolve in Japanese and come up empty in Chinese
// and English — the chart would silently vanish for most readers. The id is the same in every
// locale, and is what the translation tables key off too.
export const CHARACTER_TRAITS = {
  'STC06-001': { attack: 4, defense: 2, stability: 3, burst: 5, control: 1, ease: 4 } // 夢幻
  // 其餘角色待填
}

export function traitsOf(id) {
  return CHARACTER_TRAITS[id] || null
}

export function hasTraits(id) {
  return !!CHARACTER_TRAITS[id]
}

// Values outside the scale, or off the half-point grid, are a typo in the table above rather
// than something to render. Reported so they surface while editing instead of silently
// rounding into a slightly wrong shape.
export function validateTraits() {
  const problems = []
  Object.entries(CHARACTER_TRAITS).forEach(([id, t]) => {
    TRAIT_AXES.forEach(axis => {
      const v = t[axis]
      if (v === undefined) { problems.push(`${id}: 缺少 ${axis}`); return }
      if (typeof v !== 'number' || Number.isNaN(v)) { problems.push(`${id}.${axis}: 不是數字`); return }
      if (v < TRAIT_MIN || v > TRAIT_MAX) problems.push(`${id}.${axis}: ${v} 超出 ${TRAIT_MIN}-${TRAIT_MAX}`)
      if (Math.round(v / TRAIT_STEP) * TRAIT_STEP !== v) problems.push(`${id}.${axis}: ${v} 不是 ${TRAIT_STEP} 的倍數`)
    })
    Object.keys(t).forEach(k => {
      if (!TRAIT_AXES.includes(k)) problems.push(`${id}: 多出未知的欄位 ${k}`)
    })
  })
  return problems
}
