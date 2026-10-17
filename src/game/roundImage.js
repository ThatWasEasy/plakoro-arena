// Draws a round's pairings as a PNG, for printing or pinning up at the venue.
//
// Redrawn on a canvas rather than screenshotting the DOM: a screenshot would need a library,
// would come out at whatever size the window happened to be, and would carry the app's buttons
// with it. Drawing it means the sheet is sized for paper — big enough to read across a table —
// and contains only what someone looking for their table needs.
//
// The nameplate is drawn to match PlayerBanner.vue. They are two implementations of one design,
// which is a real cost; the alternative was the library, and a pairing sheet is the one thing
// in this tool that leaves the screen.
import {
  BACKGROUND_URLS, AVATAR_URLS, AVATAR_BORDER_URLS,
  FALLBACK_BACKGROUND, FALLBACK_AVATAR
} from '../data/nameplateAssets'
import { tableNumberOf } from './tournamentPairing'

// Drawn at 2x and scaled down by the viewer, so the text is crisp in print and when someone
// pinches into it on a phone.
const SCALE = 2

// The plate keeps the artwork's 2048x768, same as on screen.
const PLATE_W = 300
const PLATE_H = PLATE_W * 768 / 2048
const GAP = 14
const PAD = 28
const TABLE_COL = 74
const VS_COL = 34
const ROW_GAP = 10
const HEADER_H = 86

const FONT = '"Noto Sans TC", "PingFang TC", "Hiragino Sans", "Microsoft JhengHei", sans-serif'

const TITLE_TINT = {
  legend: '#FFDC73',
  gold: '#F0C244',
  epic: '#CE93E8',
  silver: '#D5DAE3',
  bronze: '#DB9A68',
  plain: 'rgba(255,255,255,.78)'
}

const cache = new Map()

function loadImage(src) {
  if (cache.has(src)) return cache.get(src)
  const p = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    // Resolves to null rather than rejecting: one missing avatar should leave a gap in the
    // sheet, not fail the whole export.
    img.onerror = () => resolve(null)
    img.src = src
  })
  cache.set(src, p)
  return p
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// `cover`, by hand: canvas has no object-fit.
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
  return s + '…'
}

// The plate's geometry, as fractions of its height.
//
// PlayerBanner.vue sizes everything in rem against --h: 3.75rem, so every value there divided
// by 3.75 is the same proportion here. Derived rather than eyeballed — hand-tuned offsets are
// how the exported plate drifted away from the on-screen one in the first place.
const F = {
  border: 0.125 / 3.75,
  padTop: 0.375 / 3.75,
  padSide: 0.5 / 3.75,
  padBottom: 0.3125 / 3.75,
  avatar: 0.42,
  mainGap: 0.4375 / 3.75,
  bodyGap: 0.125 / 3.75,
  nameFont: 0.8125 / 3.75,
  titleFont: 0.5 / 3.75,
  statFont: 0.375 / 3.75,
  avatarRadius: 0.25 / 3.75
}

function drawPlate(ctx, plate, x, y, images, t) {
  const H = PLATE_H
  const border = H * F.border

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, PLATE_W, H)
  ctx.clip()

  const bg = images.bg[plate.background] || images.bg[FALLBACK_BACKGROUND]
  if (bg) drawCover(ctx, bg, x, y, PLATE_W, H)
  else { ctx.fillStyle = '#4A4843'; ctx.fillRect(x, y, PLATE_W, H) }

  const scrim = ctx.createLinearGradient(x, 0, x + PLATE_W, 0)
  scrim.addColorStop(0, 'rgba(0,0,0,.72)')
  scrim.addColorStop(0.55, 'rgba(0,0,0,.5)')
  scrim.addColorStop(1, 'rgba(0,0,0,.15)')
  ctx.fillStyle = scrim
  ctx.fillRect(x, y, PLATE_W, H)
  ctx.restore()

  // Square corners, matching the flag on screen.
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,.22)'
  ctx.lineWidth = border
  ctx.strokeRect(x + border / 2, y + border / 2, PLATE_W - border, H - border)
  ctx.restore()

  // The content box, then the two registers inside it: the main row, and the strip at its foot.
  const left = x + border + H * F.padSide
  const right = x + PLATE_W - border - H * F.padSide
  const top = y + border + H * F.padTop
  const bottom = y + H - border - H * F.padBottom

  const statFont = H * F.statFont
  const statsH = statFont * 1.2
  const mainTop = top
  const mainBottom = bottom - statsH
  const mainMid = (mainTop + mainBottom) / 2

  // --- avatar, centred in the main row ---
  const av = H * F.avatar
  const avX = left
  const avY = mainMid - av / 2
  const avR = H * F.avatarRadius
  const frame = images.borders[plate.avatar]

  const face = images.avatars[plate.avatar] || images.avatars[FALLBACK_AVATAR]
  ctx.save()
  roundRect(ctx, avX, avY, av, av, frame ? avR * 0.75 : avR)
  ctx.clip()
  if (face) drawCover(ctx, face, avX, avY, av, av)
  else { ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(avX, avY, av, av) }
  ctx.restore()

  if (frame) {
    const fw = av * FRAME_SCALE
    const off = (fw - av) / 2
    ctx.drawImage(frame, avX - off, avY - off, fw, fw)
  } else {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,.45)'
    ctx.lineWidth = 1
    roundRect(ctx, avX, avY, av, av, avR)
    ctx.stroke()
    ctx.restore()
  }

  // --- name and title, also centred in the main row ---
  const textX = avX + av + H * F.mainGap
  const textW = right - textX
  const nameFont = H * F.nameFont
  const titleFont = H * F.titleFont
  const label = plate.title ? (plate.title.text || t(`tournament.banner.title.${plate.title.key}`)) : ''
  const titleH = titleFont * 1.6
  const blockH = label ? nameFont * 1.2 + H * F.bodyGap + titleH : nameFont * 1.2
  let ty = mainMid - blockH / 2

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.7)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  ctx.fillStyle = '#fff'
  ctx.font = `500 ${nameFont}px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.fillText(ellipsize(ctx, plate.name, textW), textX, ty)
  ctx.restore()
  ty += nameFont * 1.2 + H * F.bodyGap

  if (label) {
    ctx.font = `500 ${titleFont}px ${FONT}`
    const padX = titleFont * 0.5
    const tw = Math.min(ctx.measureText(label).width + padX * 2, textW)
    ctx.fillStyle = 'rgba(0,0,0,.4)'
    roundRect(ctx, textX, ty, tw, titleH, titleFont * 0.375)
    ctx.fill()
    const tint = TITLE_TINT[plate.title.rank] || TITLE_TINT.plain
    ctx.strokeStyle = tint
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = tint
    ctx.textBaseline = 'middle'
    ctx.fillText(ellipsize(ctx, label, tw - padX * 2), textX + padX, ty + titleH / 2)
  }

  // --- the strip at the foot: how often they win, how often they place ---
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.6)'
  ctx.shadowBlur = 2
  ctx.font = `500 ${statFont}px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,.58)'
  ctx.textBaseline = 'alphabetic'

  const m = plate.medals || {}
  const top3 = (m.gold || 0) + (m.silver || 0) + (m.bronze || 0)
  const parts = []
  if (plate.winRate !== null && plate.winRate !== undefined) {
    parts.push(`${t('tournament.banner.winRate')} ${plate.winRate}%`)
  }
  if (top3) parts.push(`${t('tournament.banner.top3')} ${top3}`)

  let sx = left
  parts.forEach(part => {
    ctx.fillText(part, sx, bottom)
    sx += ctx.measureText(part).width + statFont
  })

  // Bottom-right, opposite the strip — same corner it sits in on screen.
  if (plate.code) {
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,255,255,.95)'
    ctx.shadowColor = 'rgba(0,0,0,.9)'
    ctx.fillText(plate.code, right, bottom)
    ctx.textAlign = 'left'
  }
  ctx.restore()
}

// Both sheets need the same artwork, so loading is shared — and the cache means the second
// export of a session is immediate.
// Only the artwork the sheet actually uses. Loading the whole registry would mean decoding
// every season ever shipped to draw one afternoon's pairings.
async function loadFor(plates) {
  const used = plates.filter(Boolean)
  const bgIds = new Set([...used.map(p => p.background), FALLBACK_BACKGROUND])
  const avIds = new Set([...used.map(p => p.avatar), FALLBACK_AVATAR])
  const images = { bg: {}, avatars: {}, borders: {} }
  await Promise.all([
    ...[...bgIds].filter(id => BACKGROUND_URLS[id]).map(async id => {
      images.bg[id] = await loadImage(BACKGROUND_URLS[id])
    }),
    ...[...avIds].filter(id => AVATAR_URLS[id]).map(async id => {
      images.avatars[id] = await loadImage(AVATAR_URLS[id])
    }),
    ...[...avIds].filter(id => AVATAR_BORDER_URLS[id]).map(async id => {
      images.borders[id] = await loadImage(AVATAR_BORDER_URLS[id])
    })
  ])
  return images
}

function startSheet(W, H) {
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#FAFAF6'
  ctx.fillRect(0, 0, W, H)
  return { canvas, ctx }
}

// One header for both sheets, so a change to the title block cannot land on one and miss the
// other.
function drawHeader(ctx, W, tournament, subtitleParts) {
  ctx.fillStyle = '#3A3A3A'
  ctx.font = `700 26px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(ellipsize(ctx, tournament.name || '', W - PAD * 2), PAD, PAD + 26)

  ctx.fillStyle = '#9A9A93'
  ctx.font = `500 15px ${FONT}`
  const d = new Date(tournament.createdAt || Date.now())
  const date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  ctx.fillText([...subtitleParts, date, tournament.venue].filter(Boolean).join('  ·  '), PAD, PAD + 50)

  ctx.strokeStyle = '#ECEAE3'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, PAD + HEADER_H - 14)
  ctx.lineTo(W - PAD, PAD + HEADER_H - 14)
  ctx.stroke()
}

/**
 * Render one round's pairings to a PNG blob.
 *
 * `plateFor(playerId)` hands back the nameplate data, so this draws exactly what the screen
 * shows rather than deriving anything of its own. `t` is the i18n lookup.
 */
export async function renderRoundImage({ tournament, round, plateFor, t }) {
  const plates = []
  round.matches.forEach(m => {
    plates.push(plateFor(m.player1Id))
    if (m.player2Id !== null) plates.push(plateFor(m.player2Id))
  })
  const images = await loadFor(plates)

  const W = PAD * 2 + TABLE_COL + PLATE_W * 2 + VS_COL + GAP * 2
  const H = PAD * 2 + HEADER_H + round.matches.length * (PLATE_H + ROW_GAP) - ROW_GAP
  const { canvas, ctx } = startSheet(W, H)
  drawHeader(ctx, W, tournament, [t('tournament.roundLabel', { n: round.roundNumber })])

  // --- rows ---
  let y = PAD + HEADER_H
  round.matches.forEach(m => {
    const a = plateFor(m.player1Id)
    const b = m.player2Id === null ? null : plateFor(m.player2Id)

    ctx.fillStyle = '#3A3A3A'
    ctx.font = `700 20px ${FONT}`
    ctx.textBaseline = 'middle'
    // Via the helper, so a round with no stored numbers prints seats rather than printing
    // every real match as a bye — which is what a missing `table` used to produce here.
    const tableNo = tableNumberOf(round, m)
    const label = tableNo !== null
      ? t('tournament.detail.tableLabel', { n: tableNo })
      : t('tournament.detail.bye')
    ctx.fillText(label, PAD, y + PLATE_H / 2)

    const x1 = PAD + TABLE_COL
    if (a) drawPlate(ctx, a, x1, y, images, t)

    if (b) {
      ctx.fillStyle = '#9A9A93'
      ctx.font = `500 14px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText('VS', x1 + PLATE_W + GAP + VS_COL / 2, y + PLATE_H / 2)
      ctx.textAlign = 'left'
      drawPlate(ctx, b, x1 + PLATE_W + GAP + VS_COL + GAP, y, images, t)
    }

    ctx.textBaseline = 'alphabetic'
    y += PLATE_H + ROW_GAP
  })

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

// Columns for the standings sheet. Rank sits left of the plate; the numbers go to its right,
// each in a fixed column so they line up down the page — a sheet people read by scanning one
// column, not one row.
const RANK_COL = 58
const STAT_COLS = [
  { key: 'points', w: 70 },
  { key: 'record', w: 96 },
  { key: 'omwp', w: 84 },
  { key: 'oomwp', w: 84 }
]

/**
 * Render the standings to a PNG blob — the sheet players are handed at the end.
 */
export async function renderStandingsImage({ tournament, standings, plateFor, t }) {
  const images = await loadFor(standings.map(s => plateFor(s.playerId)))

  const statsW = STAT_COLS.reduce((n, c) => n + c.w, 0)
  const W = PAD * 2 + RANK_COL + PLATE_W + GAP + statsW
  const H = PAD * 2 + HEADER_H + 26 + standings.length * (PLATE_H + ROW_GAP) - ROW_GAP
  const { canvas, ctx } = startSheet(W, H)
  drawHeader(ctx, W, tournament, [t('tournament.detail.standingsTab')])

  // Column headings, so the four numbers are identifiable without the app next to you.
  let hx = PAD + RANK_COL + PLATE_W + GAP
  ctx.fillStyle = '#9A9A93'
  ctx.font = `500 13px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  STAT_COLS.forEach(c => {
    ctx.fillText(t(`tournament.detail.standingsHeaders.${c.key}`), hx, PAD + HEADER_H + 16)
    hx += c.w
  })

  let y = PAD + HEADER_H + 26
  standings.forEach((s, i) => {
    const plate = plateFor(s.playerId)
    const mid = y + PLATE_H / 2

    ctx.textBaseline = 'middle'
    // The podium is the one thing a results sheet is read for, so it is the one thing bolder
    // than everything around it.
    const top3 = i < 3
    ctx.fillStyle = top3 ? '#3A3A3A' : '#9A9A93'
    ctx.font = `${top3 ? 700 : 500} ${top3 ? 26 : 20}px ${FONT}`
    ctx.fillText(String(i + 1), PAD, mid)

    if (plate) drawPlate(ctx, plate, PAD + RANK_COL, y, images, t)

    let x = PAD + RANK_COL + PLATE_W + GAP
    const values = {
      points: String(s.points),
      record: `${s.wins}-${s.draws}-${s.losses}`,
      omwp: `${(s.omwp * 100).toFixed(1)}%`,
      oomwp: `${(s.oomwp * 100).toFixed(1)}%`
    }
    STAT_COLS.forEach(c => {
      ctx.fillStyle = c.key === 'points' ? '#3A3A3A' : '#9A9A93'
      ctx.font = `${c.key === 'points' ? 700 : 500} ${c.key === 'points' ? 20 : 16}px ${FONT}`
      ctx.fillText(values[c.key], x, mid)
      x += c.w
    })

    ctx.textBaseline = 'alphabetic'
    y += PLATE_H + ROW_GAP
  })

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

/**
 * One player's nameplate on its own, for them to keep or post.
 *
 * Drawn much larger than the sheets: this one is looked at by itself rather than scanned down
 * a column, and it is the image that leaves the venue.
 */
export async function renderPlayerImage({ nameplate, t }) {
  const images = await loadFor([nameplate])

  // The plate scaled up, with a margin so it reads as a finished picture rather than a crop.
  const scale = 3
  const w = PLATE_W * scale
  const h = PLATE_H * scale
  const margin = Math.round(PLATE_H * scale * 0.18)
  const W = w + margin * 2
  const H = h + margin * 2
  const { canvas, ctx } = startSheet(W, H)

  ctx.save()
  ctx.translate(margin, margin)
  ctx.scale(scale, scale)
  drawPlate(ctx, nameplate, 0, 0, images, t)
  ctx.restore()

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

// A player's own file is named after them, not the event — it is theirs to keep.
export function playerImageFileName(nameplate) {
  const safe = String(nameplate.name || 'player').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40)
  return `${nameplate.code || safe || 'player'}-${safe}.png`.replace(/^-|-$/g, '')
}

export function sheetFileName(tournament, suffix) {
  const d = new Date(tournament.createdAt || Date.now())
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const safe = String(tournament.name || 'tournament').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40)
  return `${date}-${safe || 'tournament'}-${suffix}.png`
}
