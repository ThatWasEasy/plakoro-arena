<script setup>
// A character's six ratings as a radar chart: pick from the list on the left, read the shape
// on the right.
//
// The chart exists for comparison by silhouette — a spiky figure and a round one are different
// kinds of character before a single number is read. That only works if the axes stay in the
// same places, so their order is fixed by the data rather than by anything on this screen.
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor, typeChipColor } from '../data/constants'
import { asset } from '../data/assetPath'
import { TRAIT_AXES, TRAIT_MAX, TRAIT_STEP, traitsOf } from '../data/characterTraits'

const emit = defineEmits(['back'])
const { characters } = inject('characterData')
const { t } = useI18n()

const selectedId = ref(null)

// Opens on the first character rather than an empty panel — the chart is the point of the
// screen, and an empty one makes it look broken before it has been used.
watch(characters, list => {
  if (!selectedId.value && list.length) selectedId.value = list[0].id
}, { immediate: true })

const selected = computed(() => characters.value.find(c => c.id === selectedId.value) || null)
const traits = computed(() => (selected.value ? traitsOf(selected.value.id) : null))

// The chart wears the character's own type colour, so the shape and the portrait beside it
// read as one thing. The solid chip colour rather than the pale portrait background: a 35%
// fill of an already-pale colour disappears against the card.
// Falls back to the ink the rest of the app outlines things with, not to a colour that
// appears nowhere else.
const tint = computed(() => (selected.value ? typeChipColor(selected.value.type) : '#1F1F1D'))

// --- chart geometry ---
//
// A 100x100 drawing area, but the labels sit outside the outer ring and the longest of them
// runs well past it. On screen that is invisible — SVG overflows by default — but a serialised
// copy is cropped to its viewBox, which cut the labels off the exported PNG. So the box is
// widened and everything inside stays on the same 0-100 coordinates.
const C = 50
const R = 38
const SIDES = TRAIT_AXES.length
// In user units, so they scale with the chart rather than with the page.
const LABEL_SIZE = 7
const VALUE_SIZE = 8.5

// Room for the labels outside the outer ring. The widest is two CJK glyphs plus a number, so
// roughly three characters of LABEL_SIZE each.
const PAD = Math.ceil(LABEL_SIZE * 2.4)
const VIEW_BOX = `${-PAD} ${-PAD} ${100 + PAD * 2} ${100 + PAD * 2}`

// Clockwise from straight up. -90° puts the first axis at the top; SVG's y grows downward,
// which is what makes a positive step clockwise.
function point(index, value) {
  const angle = (-90 + (360 / SIDES) * index) * Math.PI / 180
  const r = R * (value / TRAIT_MAX)
  return [C + r * Math.cos(angle), C + r * Math.sin(angle)]
}

function ring(value) {
  return TRAIT_AXES.map((_, i) => point(i, value).map(n => n.toFixed(2)).join(',')).join(' ')
}

// One ring per whole point, so the grid reads as the 0-5 scale rather than as decoration.
const RINGS = Array.from({ length: TRAIT_MAX }, (_, i) => i + 1)

const shape = computed(() => {
  if (!traits.value) return ''
  return TRAIT_AXES
    .map((axis, i) => point(i, traits.value[axis]).map(n => n.toFixed(2)).join(','))
    .join(' ')
})

// Labels sit outside the outer ring, nudged by where they fall: ones at the sides anchor
// towards the chart, ones at top and bottom stay centred over their spoke.
// How far a label sits beyond the outer ring.
//
// Labels above and below the chart need more clearance than ones beside it: those run
// outward from their anchor and clear the ring immediately, while a vertical one is centred
// on the spoke and half its height comes back towards the chart. Measured, the sides sat 7.8
// units clear and the bottom only 4.0 — so the vertical ones get their half-height back.
const LABEL_GAP = 9
const labels = computed(() => TRAIT_AXES.map((axis, i) => {
  const angle = (-90 + (360 / SIDES) * i) * Math.PI / 180
  const sin = Math.sin(angle)
  const out = R + LABEL_GAP + Math.abs(sin) * LABEL_SIZE * 0.6
  const x = C + out * Math.cos(angle)
  const y = C + out * sin
  const cos = Math.cos(angle)
  return {
    axis,
    x, y,
    anchor: Math.abs(cos) < 0.1 ? 'middle' : cos > 0 ? 'start' : 'end',
    value: traits.value ? traits.value[axis] : null
  }
}))

// Trailing zeros dropped: 4 rather than 4.0, but 4.5 kept.
function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

// --- export ---
//
// The chart on screen is serialised rather than redrawn. Redrawing would mean a second
// implementation of the same geometry, and two implementations of one picture drift — the
// exported plate elsewhere in this app did exactly that before it was rebuilt from shared
// proportions.
//
// The catch is that the live SVG is styled by a scoped stylesheet and CSS variables, neither of
// which survives being pulled out of the document. So every painted property is read off the
// computed style and written onto the clone as an attribute.
const PAINTED = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin',
  'paint-order', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline'
]

const chartEl = ref(null)
const exporting = ref(false)

function inlineStyles(live, clone) {
  const cs = getComputedStyle(live)
  PAINTED.forEach(prop => {
    const v = cs.getPropertyValue(prop)
    if (v && v !== 'none' || prop === 'fill') clone.setAttribute(prop, v)
  })
  clone.removeAttribute('class')
  const liveKids = live.children
  const cloneKids = clone.children
  for (let i = 0; i < liveKids.length; i++) inlineStyles(liveKids[i], cloneKids[i])
}

async function saveChart() {
  const live = chartEl.value
  if (!live || exporting.value) return
  exporting.value = true
  try {
    const clone = live.cloneNode(true)
    inlineStyles(live, clone)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    // The export's viewBox is measured, not guessed. Labels sit outside the chart and their
    // width depends on the font and the language — estimating it left the right-hand labels
    // cropped. getBBox reports what the browser actually laid out, including the text.
    const bb = live.getBBox()
    const m = 2
    const vx = bb.x - m, vy = bb.y - m
    const vw = bb.width + m * 2, vh = bb.height + m * 2
    clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`)

    // Square output, with the measured content centred in it.
    const SIZE = 1200
    const scale = SIZE / Math.max(vw, vh)
    const outW = Math.round(vw * scale)
    const outH = Math.round(vh * scale)
    clone.setAttribute('width', outW)
    clone.setAttribute('height', outH)

    const svg = new XMLSerializer().serializeToString(clone)
    const img = new Image()
    // Base64 rather than a blob URL: a blob URL taints the canvas in some browsers, and a
    // tainted canvas cannot be read back out as a PNG.
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    // A ground rather than transparency: the labels are dark, and a transparent PNG of dark
    // text disappears the moment it is dropped on anything dark.
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#fff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)

    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.value.name}-traits.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="board select-board tc-board" :style="{ '--tint': tint }">
    <div class="modal-title tc-title">{{ t('traitChart.title') }}</div>

    <div class="tc-split">
      <!-- left: every character -->
      <div class="tc-list">
        <button
          v-for="c in characters"
          :key="c.id"
          :class="['tc-item', { on: c.id === selectedId }]"
          @click="selectedId = c.id"
        >
          <span class="tc-portrait" :style="{ background: typeBgColor(c.type) }">
            <img :src="c.imageUrl || asset(`image/CHARA/${c.name}.png`)" class="img-icon" :alt="c.name">
          </span>
          <span class="tc-item-name">{{ c.name }}</span>
        </button>
      </div>

      <!-- right: the chart -->
      <div class="tc-panel">
        <template v-if="selected">
          <div class="tc-head">
            <span class="tc-portrait lg" :style="{ background: typeBgColor(selected.type) }">
              <img :src="selected.imageUrl || asset(`image/CHARA/${selected.name}.png`)" class="img-icon" :alt="selected.name">
            </span>
            <span class="tc-head-name">{{ selected.name }}</span>
          </div>

          <svg v-if="traits" ref="chartEl" class="tc-chart" :viewBox="VIEW_BOX" role="img" :aria-label="selected.name">
            <!-- grid: one ring per point on the scale -->
            <polygon
              v-for="r in RINGS"
              :key="r"
              :points="ring(r)"
              class="tc-ring"
              :class="{ outer: r === TRAIT_MAX }"
            />
            <!-- spokes -->
            <line
              v-for="(l, i) in labels"
              :key="'s' + i"
              :x1="C" :y1="C"
              :x2="point(i, TRAIT_MAX)[0]" :y2="point(i, TRAIT_MAX)[1]"
              class="tc-spoke"
            />
            <polygon :points="shape" class="tc-shape" />
            <circle
              v-for="(l, i) in labels"
              :key="'d' + i"
              :cx="point(i, l.value)[0]" :cy="point(i, l.value)[1]" r="1.4"
              class="tc-dot"
            />
            <!-- The reading rides with its axis label rather than sitting on the vertex:
                 out here it never lands on the filled shape, so it needs no halo to stay
                 legible, and the chart keeps its own area clear. -->
            <text
              v-for="(l, i) in labels"
              :key="'t' + i"
              :x="l.x" :y="l.y"
              :text-anchor="l.anchor"
              class="tc-label"
              :font-size="LABEL_SIZE"
              font-weight="800"
            >{{ t('traitChart.axis.' + l.axis) }} <tspan class="tc-label-num" :font-size="VALUE_SIZE" font-weight="900">{{ fmt(l.value) }}</tspan></text>
          </svg>

          <!-- Said plainly rather than drawn as zeros: an all-zero hexagon would read as a
               rating of "bad at everything", which is not what a missing row means. -->
          <div v-else class="tc-empty">{{ t('traitChart.noData') }}</div>
        </template>
      </div>
    </div>

    <div class="tc-foot">
      <button
        v-if="traits"
        class="btn secondary"
        :disabled="exporting"
        @click="saveChart"
      >{{ exporting ? t('traitChart.saving') : t('traitChart.saveImage') }}</button>
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.tc-board { display: flex; flex-direction: column; min-height: 0; }
.tc-title { margin: 0.5rem 0 0.25rem; flex-shrink: 0; }

.tc-split {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0.625rem;
  padding: 0 0.625rem;
}

/* --- left --- */
.tc-list {
  width: 9rem;
  flex-shrink: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.tc-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.375rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--card);
  box-shadow: var(--shadow);
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.tc-item.on { background: var(--accent); }
.tc-item:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.125rem; }
.tc-item-name {
  font-size: 0.6875rem;
  font-weight: 800;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tc-portrait {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.375rem;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.tc-portrait.lg { width: 2.25rem; height: 2.25rem; border-radius: 0.5rem; }
.tc-portrait img { width: 100%; height: 100%; object-fit: cover; }

/* --- right --- */
.tc-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--card);
  border-radius: 0.75rem;
  box-shadow: var(--shadow);
  padding: 0.625rem 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.tc-head { display: flex; align-items: center; gap: 0.5rem; align-self: flex-start; }
.tc-head-name { font-size: 1rem; font-weight: 900; color: var(--ink); }

.tc-chart { width: 100%; max-width: 19rem; aspect-ratio: 1; flex-shrink: 1; min-height: 0; }
.tc-ring { fill: none; stroke: var(--line); stroke-width: 0.4; }
.tc-ring.outer { stroke: var(--sub); stroke-width: 0.6; }
.tc-spoke { stroke: var(--line); stroke-width: 0.4; }
.tc-shape {
  fill: var(--tint);
  fill-opacity: 0.28;
  stroke: var(--tint);
  stroke-width: 1.2;
  stroke-linejoin: round;
}
.tc-dot { fill: var(--tint); }

/* Font sizes are set as attributes on the elements, not here.
 *
 * A CSS `font-size` on SVG text resolves against the page, not the viewBox — so the glyphs
 * keep their pixel size while the chart around them scales, and the labels swell or shrink
 * relative to the chart every time the window changes. Worse, with no rule applying at all
 * the text inherited the root size, which this app scales with the stage: the labels came out
 * 28 units tall inside a 100-unit chart.
 *
 * Set as attributes they are user units, so they scale with everything else and the layout
 * holds at any size. */
.tc-label { fill: var(--sub); dominant-baseline: middle; }
.tc-label-num { fill: var(--ink); }
.tc-empty {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--sub);
  text-align: center;
  line-height: 1.8;
  padding: 1.5rem 0.5rem;
}

.tc-foot { display: flex; gap: 0.625rem; justify-content: center; padding: 0.75rem 0 0.25rem; flex-shrink: 0; }
</style>
