// Builds the 6 face textures for a 3D die as <canvas> elements, in the same visual language as
// the 2D chips (see ChipIcon.vue): a single-type face is flat type colour with its glyph centred,
// a dual-type face is the square split corner to corner into the two type colours with a glyph in
// each half.
import { asset } from '../data/assetPath'
import { typeChipColor } from '../data/constants'

const TEX_SIZE = 256
const imageCache = new Map()

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src)
  const promise = new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
  imageCache.set(src, promise)
  return promise
}

function makeCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_SIZE
  canvas.height = TEX_SIZE
  return canvas
}

function fillBackground(ctx, color) {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
}

// The face is painted from the type's own colour and its glyph, rather than by stamping the whole
// ICON/{type}.png badge onto a matching background.
//
// Stamping the badge is what made these faces look wrong: the badge carries a white outline, so
// laying it over a same-coloured fill left a white square drawn inside the face — and on a
// dual-type face, two of them, which is exactly the "two chips" reading the 2D chips had.
// TYPE_CHIP_COLORS is sampled from the badges at full resolution, and glyph/{type}.png is the
// same artwork with plate and outline removed, so the two always agree.
//
// The old code sampled the colour live from pixel (width/2, 2) — two pixels down the top edge,
// which is on the outline, not the fill.

function drawBorder(ctx) {
  ctx.strokeStyle = '#DEDACD'
  ctx.lineWidth = 8
  ctx.strokeRect(4, 4, TEX_SIZE - 8, TEX_SIZE - 8)
}

// `tintFromIcon` only makes sense for the energy-type badge icons (solid colored squares) — the
// character die's ICON/{上,下,...}.png are black line-art symbols with a black outline, so
// sampling their color would fill the face black and hide the symbol.
export async function buildSingleFaceTexture(type, { tintFromIcon = true } = {}) {
  const canvas = makeCanvas()
  const ctx = canvas.getContext('2d')
  if (tintFromIcon) {
    // Energy face: flat type colour with the white glyph on it.
    fillBackground(ctx, typeChipColor(type))
    drawBorder(ctx)
    const img = await loadImage(asset(`image/ICON/glyph/${type}.png`))
    const size = TEX_SIZE * 0.62
    const at = (TEX_SIZE - size) / 2
    ctx.drawImage(img, at, at, size, size)
  } else {
    // Character die: black line art on white, so it goes down as-is — there's no coloured plate
    // to strip and no glyph-only version of these.
    fillBackground(ctx, '#FFFFFF')
    drawBorder(ctx)
    const img = await loadImage(asset(`image/ICON/${type}.png`))
    const pad = TEX_SIZE * 0.08
    ctx.drawImage(img, pad, pad, TEX_SIZE - pad * 2, TEX_SIZE - pad * 2)
  }
  return canvas
}

export async function buildDualFaceTexture(types) {
  const canvas = makeCanvas()
  const ctx = canvas.getContext('2d')
  const [imgA, imgB] = await Promise.all(
    types.map(t => loadImage(asset(`image/ICON/glyph/${t}.png`))))
  const iconSize = TEX_SIZE * 0.42
  const inset = TEX_SIZE * 0.06

  // Two triangles of flat colour meeting on the diagonal, then a glyph in each. No divider is
  // drawn — the colour change is the split, and a line over it only reads as a seam.
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(TEX_SIZE, 0)
  ctx.lineTo(0, TEX_SIZE)
  ctx.closePath()
  ctx.clip()
  fillBackground(ctx, typeChipColor(types[0]))
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(TEX_SIZE, 0)
  ctx.lineTo(TEX_SIZE, TEX_SIZE)
  ctx.lineTo(0, TEX_SIZE)
  ctx.closePath()
  ctx.clip()
  fillBackground(ctx, typeChipColor(types[1]))
  ctx.restore()

  ctx.drawImage(imgA, inset, inset, iconSize, iconSize)
  ctx.drawImage(imgB, TEX_SIZE - inset - iconSize, TEX_SIZE - inset - iconSize, iconSize, iconSize)

  drawBorder(ctx)

  return canvas
}

// Builds the 6 canvases for an assembled energy die, in the BoxGeometry material-index
// order ([+X, -X, +Y, -Y, +Z, -Z]) so callers can hand them straight to a Three.js material
// array. Order of face -> axis is arbitrary (there's no "correct" side for "convex"), it just
// has to match whatever face-detection logic reads the result back.
export async function buildEnergyDieFaces(die) {
  const [posX, negX, posY, negY, posZ, negZ] = await Promise.all([
    buildSingleFaceTexture(die.convexType),
    buildSingleFaceTexture(die.concaveType),
    buildSingleFaceTexture(die.singleSlots[0].type),
    buildSingleFaceTexture(die.singleSlots[1].type),
    buildDualFaceTexture(die.dualSlots[0].types),
    buildDualFaceTexture(die.dualSlots[1].types)
  ])
  return {
    canvases: [posX, negX, posY, negY, posZ, negZ],
    // Which logical face sits on which axis, so the roll result can be read back after the
    // physics settles.
    faceByAxis: ['convex', 'concave', 'single1', 'single2', 'dual1', 'dual2']
  }
}

export async function buildCharaDieFaces() {
  const order = ['右', '左', '上', '下', '立', '逆'] // +X, -X, +Y, -Y, +Z, -Z
  const canvases = await Promise.all(order.map(type => buildSingleFaceTexture(type, { tintFromIcon: false })))
  return { canvases, faceByAxis: order }
}
