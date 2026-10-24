export const TYPE_KANJI = {
  "くさ": "草",
  "ほのお": "炎",
  "みず": "水",
  "かみなり": "電",
  "エスパー": "超",
  "かくとう": "闘",
  "あく": "悪",
  "はがね": "鋼",
  "ひこう": "飛",
  "ドラゴン": "龍",
  "ノーマル": "無"
}

export function typeVar(t) {
  return `var(--t-${t})`
}

export const TYPE_BG_COLORS = {
  "無色": "#E4DFD2",
  "ちょう": "#DCC4EC",
  "かくとう": "#FFC79A",
  "ほのお": "#FFACAC",
  "みず": "#A8D4EA",
  "くさ": "#B8E6C0",
  "はがね": "#D3D6DA",
  "あく": "#A3D9CE",
  "ひこう": "#C6E6FA",
  "かみなり": "#FFE58A"
}

export const TYPE_BG_FALLBACK = "#ECEAE3"

// The saturated colour each energy badge is printed in, sampled from the icon PNGs themselves
// (public/image/ICON/*.png) at full resolution, so the two can never drift apart. Sampling a
// downscaled copy is not good enough: the averaging shifted every value enough to leave a
// visible patch where a badge sat on top of a fill that was supposed to match it exactly.
//
// Distinct from TYPE_BG_COLORS above, which are the pale card tints. These are needed wherever a
// chip has to be drawn rather than shown: a dual-energy chip is one square split corner to corner
// in two colours, and filling it means knowing the colour, not just having the badge image.
export const TYPE_CHIP_COLORS = {
  "くさ": "#1FAC48",
  "ほのお": "#E72148",
  "みず": "#0077C5",
  "かみなり": "#FBC200",
  "はがね": "#8A8FA7",
  "あく": "#007D97",
  "かくとう": "#EE7300",
  "ちょう": "#CE3A90",
  "ひこう": "#49BDEA",
  "無色": "#BCACAD"
}

export function typeChipColor(t) {
  return TYPE_CHIP_COLORS[t] || TYPE_BG_FALLBACK
}

export const CARD_BOTTOM_DARK = "#262420"

export function typeBgColor(t) {
  return TYPE_BG_COLORS[t] || TYPE_BG_FALLBACK
}
