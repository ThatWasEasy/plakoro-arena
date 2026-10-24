// What energy-die parts each retail product actually contains.
//
// `jpy` is the Japanese list price. It is never shown — the planner is a parts list, not a price
// list — but it has to be here, because the objective needs it: boxes are not interchangeable
// units. The DX set holds roughly three starters' worth of parts, so "fewest boxes" would rank
// one DX box above three starters and recommend the more expensive option while appearing to
// recommend the smaller one.
//
// Source: pla-koro.com's product database, which counted them off the official BANDAI product
// photos. Types are named the way that site names them (火 for the official 炎, 格 for 鬥,
// 飛 for 空); TYPE_FROM_ZH below maps them onto the Japanese names the rest of this codebase
// uses, so nothing outside this file has to know about the discrepancy.
//
// Every `confirmed` set is internally consistent with its own printed contents list: a starter
// set lists "改裝晶片 ×18", and its single + dual counts add up to exactly 18. That agreement is
// the reason this data is trustworthy enough to base a shopping list on.
//
// `release` is the announced on-sale date, either a full date or just a month when that's all
// BANDAI has said. It matters because a shopping list is useless if half of it isn't in shops
// yet: the planner has to separate "buy this today" from "this would help, in December".
//
// `status` is carried through rather than filtered out, because "we don't know" and "it's
// random" are answers the planner has to be able to give:
//   confirmed - counted off the photos, safe to plan against
//   unknown   - not yet published or not yet counted
//   random    - a blind box: the six Pokémon in a wave share one SKU, so which parts you get
//               is decided when you open it


import { CONVEX_TYPES, CONCAVE_TYPES } from '../game/diceParts'

// The source site writes types in Chinese; the game data uses Japanese.
export const TYPE_FROM_ZH = {
  草: 'くさ', 火: 'ほのお', 水: 'みず', 雷: 'かみなり', 鋼: 'はがね',
  惡: 'あく', 格: 'かくとう', 超: 'ちょう', 飛: 'ひこう'
}
export const TYPE_TO_ZH = Object.fromEntries(Object.entries(TYPE_FROM_ZH).map(([zh, ja]) => [ja, zh]))

export const PART_STATUS = { confirmed: 'confirmed', unknown: 'unknown', random: 'random' }

// A half-die carries one fixed face. Which pool it belongs to is decided by its type, not by
// anything in the data — the convex face can only ever be one of five types and the concave one
// of four, so a count of "火 halves" is unambiguously a count of convex halves.
export function halfKind(jaType) {
  if (CONVEX_TYPES.includes(jaType)) return 'convex'
  if (CONCAVE_TYPES.includes(jaType)) return 'concave'
  return null
}

// Raw counts keyed by the source site's Chinese type names. `dual` keys are "A+B" pairs, and
// a pair of the same type (火+火) is a real printed chip, not a data error — which is what
// makes an all-one-type die buildable at all.
const RAW = {
  st01: { id: '01_7173', name: '啟程套組 妙蛙種子 01', category: 'starter', jpy: 900, release: '2026-07-18', status: 'confirmed',
    halves: { 草: 1, 惡: 1, 火: 1, 格: 1, 雷: 1, 超: 1 },
    single: { 草: 3, 飛: 1, 水: 1, 火: 1, 鋼: 1, 惡: 1, 格: 1 },
    dual: { '草+草': 5, '惡+草': 2, '惡+惡': 1, '格+格': 1 } },
  st02: { id: '01_7174', name: '啟程套組 小火龍 02', category: 'starter', jpy: 900, release: '2026-07-18', status: 'confirmed',
    halves: { 火: 1, 雷: 1, 鋼: 1, 格: 1, 飛: 1, 超: 1 },
    single: { 火: 3, 雷: 1, 水: 1, 草: 1, 鋼: 1, 惡: 1, 格: 1 },
    dual: { '火+火': 5, '火+雷': 1, '超+超': 1, '鋼+雷': 1, '火+鋼': 1 } },
  st03: { id: '01_7175', name: '啟程套組 傑尼龜 03', category: 'starter', jpy: 900, release: '2026-07-18', status: 'confirmed',
    halves: { 草: 1, 格: 1, 水: 1, 飛: 1, 雷: 1, 惡: 1 },
    single: { 水: 3, 超: 1, 火: 1, 草: 1, 鋼: 1, 惡: 1, 格: 1 },
    dual: { '水+水': 5, '格+水': 2, '格+格': 1, '惡+草': 1 } },
  st04: { id: '01_7176', name: '啟程套組 皮卡丘 04', category: 'starter', jpy: 900, release: '2026-07-18', status: 'confirmed',
    halves: { 鋼: 1, 格: 1, 水: 1, 飛: 1, 雷: 1, 惡: 1 },
    single: { 雷: 3, 超: 1, 火: 1, 草: 1, 鋼: 1, 惡: 1, 格: 1 },
    dual: { '雷+雷': 5, '鋼+雷': 2, '惡+惡': 1, '火+雷': 1 } },
  st05: { id: '01_7177', name: '啟程套組 伊布 05', category: 'starter', jpy: 900, release: '2026-07-18', status: 'confirmed',
    halves: { 火: 1, 飛: 1, 草: 1, 超: 1, 水: 1, 惡: 1 },
    single: { 飛: 3, 超: 1, 雷: 1, 水: 1, 鋼: 1, 惡: 1, 格: 1 },
    dual: { '飛+飛': 4, '超+飛': 1, '惡+飛': 1, '格+格': 1, '惡+惡': 1, '惡+超': 1 } },
  st06: { id: '01_7178', name: '啟程套組 夢幻 06', category: 'starter', jpy: 900, release: '2026-07-18', status: 'confirmed',
    halves: { 火: 1, 水: 1, 草: 1, 超: 1, 格: 1, 惡: 1 },
    single: { 超: 4, 飛: 1, 雷: 1, 鋼: 1, 惡: 1, 格: 1 },
    dual: { '超+超': 5, '惡+超': 1, '格+水': 1, '格+格': 1, '惡+惡': 1 } },
  st07: { id: '01_7179', name: '啟程套組 耿鬼 07', category: 'starter', jpy: 900, release: '2026-09-12', status: 'confirmed',
    halves: { 草: 1, 惡: 1, 鋼: 1, 超: 1, 火: 1, 飛: 1 },
    single: { 惡: 3, 雷: 1, 超: 2, 飛: 1, 格: 1, 水: 1 },
    dual: { '惡+惡': 5, '惡+超': 2, '火+飛': 1, '雷+飛': 1 } },
  st08: { id: '01_7180', name: '啟程套組 巨金怪 08', category: 'starter', jpy: 900, release: '2026-09-12', status: 'confirmed',
    halves: { 火: 1, 超: 1, 鋼: 1, 惡: 1, 雷: 1, 飛: 1 },
    single: { 鋼: 3, 雷: 1, 格: 1, 惡: 1, 水: 1, 火: 1, 草: 1 },
    dual: { '鋼+鋼': 5, '格+鋼': 1, '雷+雷': 1, '水+飛': 1, '格+草': 1 } },
  st09: { id: '01_7181', name: '啟程套組 路卡利歐 09', category: 'starter', jpy: 900, release: '2026-09-12', status: 'confirmed',
    halves: { 鋼: 1, 格: 1, 水: 1, 飛: 1, 雷: 1, 超: 1 },
    single: { 格: 3, 惡: 1, 鋼: 2, 火: 1, 超: 1, 雷: 1 },
    dual: { '格+格': 5, '格+鋼': 2, '火+雷': 1, '鋼+鋼': 1 } },

  // Expedition small boxes carry no half-dice at all — a figure and a handful of chips only, so
  // they top up chips and can never supply a fixed face. Sold at retail as a blind box, but
  // players resell the ones they've opened as 確認款, so a specific figure is obtainable and the
  // planner treats it as any other product.
  eb01s07: { id: 'eb01_07', name: '探險盒組 凱羅斯 07', category: 'expeditionSmall', jpy: 350, release: '2026-07-18', status: 'confirmed',
    halves: {}, single: { 草: 2 }, dual: { '草+草': 1, '格+格': 1 } },
  eb01s08: { id: 'eb01_08', name: '探險盒組 火焰鳥 08', category: 'expeditionSmall', jpy: 350, release: '2026-07-18', status: 'confirmed',
    halves: {}, single: { 火: 1, 飛: 1 }, dual: { '火+火': 1, '飛+飛': 1 } },
  eb01s09: { id: 'eb01_09', name: '探險盒組 急凍鳥 09', category: 'expeditionSmall', jpy: 350, release: '2026-07-18', status: 'confirmed',
    halves: {}, single: { 水: 1, 飛: 1 }, dual: { '水+水': 1, '飛+飛': 1 } },
  eb01s10: { id: 'eb01_10', name: '探險盒組 閃電鳥 10', category: 'expeditionSmall', jpy: 350, release: '2026-07-18', status: 'confirmed',
    halves: {}, single: { 雷: 1, 飛: 1 }, dual: { '雷+雷': 1, '飛+飛': 1 } },
  eb01s11: { id: 'eb01_11', name: '探險盒組 大岩蛇 11', category: 'expeditionSmall', jpy: 350, release: '2026-07-18', status: 'confirmed',
    halves: {}, single: { 格: 2 }, dual: { '格+格': 2 } },
  eb01s12: { id: 'eb01_12', name: '探險盒組 臭泥 12', category: 'expeditionSmall', jpy: 350, release: '2026-07-18', status: 'confirmed',
    halves: {}, single: { 惡: 2 }, dual: { '惡+惡': 2 } },

  dx01: { id: '01_7285', name: 'DX 啟程套組 01（皮卡丘・伊布・夢幻）', category: 'dx', jpy: 4000, release: '2026-12', status: 'confirmed',
    halves: { 鋼: 1, 格: 2, 水: 3, 飛: 2, 雷: 1, 惡: 3, 火: 2, 草: 2, 超: 2 },
    single: { 雷: 5, 超: 6, 火: 1, 草: 1, 鋼: 3, 惡: 3, 格: 3, 飛: 4, 水: 1 },
    dual: { '雷+雷': 5, '鋼+雷': 2, '惡+惡': 3, '火+雷': 1, '飛+飛': 4, '超+飛': 1, '惡+飛': 1,
            '格+格': 2, '惡+超': 2, '超+超': 5, '格+水': 1 } }
}


function toJa(counts) {
  const out = {}
  Object.entries(counts || {}).forEach(([zh, n]) => { out[TYPE_FROM_ZH[zh] || zh] = n })
  return out
}

function dualToJa(counts) {
  const out = {}
  Object.entries(counts || {}).forEach(([pair, n]) => {
    const key = pair.split('+').map(z => TYPE_FROM_ZH[z] || z).sort().join('+')
    out[key] = (out[key] || 0) + n
  })
  return out
}

// Products with their type names translated, and halves split into the two pools so callers
// never have to re-derive which face a type belongs to.
// The grid shows a lot of these side by side, so the category prefix (which the section heading
// already says) is dropped: "啟程套組 小火龍 02" reads as "小火龍 02".
function shortName(name) {
  return name.replace(/^(啟程套組|探險盒組|DX 啟程套組)\s*/, '')
}

export const PRODUCT_PARTS = Object.entries(RAW).map(([key, p]) => {
  const halves = toJa(p.halves)
  const convex = {}
  const concave = {}
  Object.entries(halves).forEach(([ja, n]) => {
    if (halfKind(ja) === 'convex') convex[ja] = n
    else if (halfKind(ja) === 'concave') concave[ja] = n
  })
  return { key, ...p, shortName: shortName(p.name), convex, concave, single: toJa(p.single), dual: dualToJa(p.dual) }
})

// Whether a product is on sale as of `asOf`. Month-only dates count from the 1st: BANDAI hasn't
// named a day, so the first of the month is the earliest it could be out, and treating it as
// later would keep saying "not yet" through the whole month it actually shipped in.
export function isReleased(product, asOf = new Date()) {
  if (!product.release) return false
  const parts = product.release.split('-').map(Number)
  const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1)
  return d <= asOf
}

// True when only the month is known — the UI should say "December" rather than invent the 1st.
export function releaseIsMonthOnly(product) {
  return !!product.release && product.release.split('-').length === 2
}

export const PRODUCT_PARTS_BY_KEY = Object.fromEntries(PRODUCT_PARTS.map(p => [p.key, p]))
