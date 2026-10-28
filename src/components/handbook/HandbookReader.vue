<script setup>
// One chapter, rendered page by page.
//
// Teleported to <body> and sized in viewport units, which makes it the one screen in this app
// that is not inside #stage. That is deliberate and it is the whole reason this component
// exists separately: the stage is a fixed 16:9 box that rotates 90° on a phone held upright,
// so a reader living inside it would ask someone to turn their phone sideways to read a
// portrait A4 page — and then show them about half of it. Stepping outside means the book is
// read the way a book is held.
//
// Because it is outside the stage, `rem` is the wrong unit here: the root font-size tracks
// the stage's short edge, and this screen has no relationship to the stage. Sizes are in
// viewport units and px on purpose, and this is the only place in the project where that is
// the right answer.
//
// Canvas rather than <iframe>: iOS Safari renders PDFs in iframes badly — blank, or only the
// first page — and an iframe brings the browser's own toolbar, which includes a download
// button. A download button on paid content undoes the entitlement check that fetched it.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchUnit } from '../../data/handbookSource'

const props = defineProps({
  unit: { type: Object, required: true },
  // Tiled faintly across every page. Not a lock — a reader can still photograph the screen —
  // but it makes a leaked copy say who leaked it, which is the part that actually changes
  // behaviour. Tiled and diagonal rather than tucked in a corner, because a corner mark is
  // removed by cropping or by trimming the margin off a printout.
  watermark: { type: String, default: '' }
})
const emit = defineEmits(['close'])
const { t } = useI18n()

// Zoom is applied as display width, not by re-rendering: pages are rasterised once at
// MAX_CANVAS_WIDTH, which is wider than any phone, so enlarging up to that ceiling only uses
// detail the canvas already holds. Re-rendering 31 pages on every tap of + would be the
// obvious implementation and a much worse one.
const ZOOM_STEPS = [0.8, 1, 1.25, 1.5, 2, 2.5]
const ZOOM_KEY = 'plakoro_handbook_zoom_v1'

function loadZoom() {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY))
    return ZOOM_STEPS.includes(n) ? n : 1
  } catch (e) {
    return 1
  }
}

const zoom = ref(loadZoom())

function stepZoom(dir) {
  const i = ZOOM_STEPS.indexOf(zoom.value)
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]
  zoom.value = next
  try {
    localStorage.setItem(ZOOM_KEY, String(next))
  } catch (e) {
    // A reading preference that does not survive a reload is not worth failing over.
  }
}

const canZoomOut = computed(() => zoom.value > ZOOM_STEPS[0])
const canZoomIn = computed(() => zoom.value < ZOOM_STEPS[ZOOM_STEPS.length - 1])

const pages = shallowRef([])
const loading = ref(true)
const error = ref('')
const scrollerRef = ref(null)
const currentPage = ref(1)

let doc = null
let cancelled = false

// Capped because a canvas that large is slow to paint and, on iOS, can fail outright — the
// same ceiling the image export ran into.
const MAX_CANVAS_WIDTH = 1600

// Faint enough to read straight through, dark enough to still be legible in a photo of a
// screen. This is close to the floor: much below 0.03 and a phone camera's noise swallows it,
// which would leave the mark costing contrast while no longer identifying anyone.
const MARK_ALPHA = 0.038
const MARK_ANGLE = -Math.PI / 6

/**
 * Burn the reader's code across the page.
 *
 * Drawn into the canvas rather than laid over it in the DOM: an overlay is one devtools click
 * from gone, and "save image" would write out a clean copy. Once it is in the pixels, every
 * route the page can leave by carries it.
 */
function stamp(ctx, width, height, text) {
  if (!text) return
  ctx.save()
  ctx.globalAlpha = MARK_ALPHA
  ctx.fillStyle = '#000'
  ctx.font = `700 ${Math.round(width * 0.038)}px "Hiragino Sans", system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.rotate(MARK_ANGLE)
  const stepX = ctx.measureText(text).width * 1.75
  const stepY = width * 0.115
  // Rotating moves the page out from under the origin, so the grid is drawn over a box big
  // enough to still cover every corner afterwards.
  for (let y = -width; y < height + width; y += stepY) {
    const offset = (Math.round(y / stepY) % 2) * (stepX / 2)
    for (let x = -height; x < width + height; x += stepX) {
      ctx.fillText(text, x + offset, y)
    }
  }
  ctx.restore()
}

async function render() {
  loading.value = true
  error.value = ''
  pages.value = []
  try {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
    // Vite bundles the worker from the package rather than a CDN: the artifact CSP aside,
    // this app has to keep working offline-ish on venue wifi.
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    GlobalWorkerOptions.workerSrc = worker.default

    const data = await fetchUnit(props.unit.id)
    if (cancelled) return
    doc = await getDocument({ data }).promise

    const out = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const target = Math.min(window.innerWidth * (window.devicePixelRatio || 1), MAX_CANVAS_WIDTH)
      const viewport = page.getViewport({ scale: target / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      stamp(ctx, canvas.width, canvas.height, props.watermark)
      out.push({ n, url: canvas.toDataURL('image/jpeg', 0.86), ratio: viewport.height / viewport.width })
      pages.value = [...out]
    }
  } catch (e) {
    error.value = e.message === 'locked' ? t('handbook.locked') : t('handbook.loadFailed')
  } finally {
    loading.value = false
  }
}

function onScroll() {
  const el = scrollerRef.value
  if (!el) return
  const mid = el.scrollTop + el.clientHeight / 2
  const kids = [...el.querySelectorAll('.hr-page')]
  const i = kids.findIndex(k => k.offsetTop + k.offsetHeight > mid)
  currentPage.value = (i === -1 ? kids.length : i + 1) || 1
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  // The page behind must not scroll while a full-screen reader is open.
  document.body.style.overflow = 'hidden'
  render()
})
onBeforeUnmount(() => {
  cancelled = true
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  doc?.destroy?.()
})
watch(() => props.unit.id, render)

const total = computed(() => doc?.numPages || props.unit.pages || 0)
</script>

<template>
  <Teleport to="body">
    <div class="hr">
      <header class="hr-bar">
        <button class="hr-close" :aria-label="t('common.back')" @click="emit('close')">✕</button>
        <div class="hr-title">{{ unit.title }}</div>
        <div class="hr-zoom">
          <button :disabled="!canZoomOut" :aria-label="t('handbook.zoomOut')" @click="stepZoom(-1)">−</button>
          <span class="hr-zoom-val">{{ Math.round(zoom * 100) }}%</span>
          <button :disabled="!canZoomIn" :aria-label="t('handbook.zoomIn')" @click="stepZoom(1)">＋</button>
        </div>
        <div class="hr-count">{{ pages.length ? `${currentPage} / ${total}` : '' }}</div>
      </header>

      <div v-if="loading && !pages.length" class="hr-state">{{ t('handbook.loading') }}</div>
      <div v-else-if="error" class="hr-state">{{ error }}</div>

      <div
        v-else
        ref="scrollerRef"
        class="hr-scroll"
        :style="{ '--z': zoom }"
        @scroll.passive="onScroll"
      >
        <div v-for="p in pages" :key="p.n" class="hr-page">
          <img :src="p.url" :alt="`${unit.title} ${p.n}`" draggable="false">
        </div>
        <div v-if="loading" class="hr-more">{{ t('handbook.loadingMore') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Viewport units, not rem — see the note at the top: this screen is outside #stage, and the
   root font-size belongs to the stage. */
.hr {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: #2B2A26;
  display: flex;
  flex-direction: column;
  /* Discourages the casual copy. It does not stop a screenshot and is not pretending to. */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.hr-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: max(8px, env(safe-area-inset-top)) 12px 8px;
  background: #1F1F1D;
  color: #fff;
}
.hr-close {
  flex: none;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}
.hr-title { flex: 1; font-size: 15px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.hr-zoom { flex: none; display: flex; align-items: center; gap: 2px; }
.hr-zoom button {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.hr-zoom button:disabled { opacity: .35; cursor: default; }
.hr-zoom-val {
  min-width: 42px;
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}
.hr-count { flex: none; font-size: 12px; color: rgba(255, 255, 255, 0.7); font-variant-numeric: tabular-nums; }

/* Horizontal scrolling appears only once zoomed past the frame. */
.hr-scroll { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }
/* Both dimensions scale, or the comfortable-reading cap silently wins and the + button does
   nothing on a wide screen — which is exactly what it did the first time. */
.hr-page {
  position: relative;
  margin: 0 auto 10px;
  width: calc(100% * var(--z, 1));
  max-width: calc(900px * var(--z, 1));
}
.hr-page img { display: block; width: 100%; height: auto; }
.hr-state, .hr-more {
  padding: 32px 20px;
  text-align: center;
  color: rgba(255, 255, 255, 0.75);
  font-size: 14px;
}
</style>
