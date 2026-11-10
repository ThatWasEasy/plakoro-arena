<script setup>
// The book, read continuously.
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
//
// It takes the whole ordered book rather than one chapter, because a 450-page book cut into
// 27 files should not make someone close the reader, find the shelf, and find their place
// again 26 times. Reaching the end of a chapter loads the next one under it; the ☰ sheet
// switches to any chapter directly.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchUnit } from '../../data/handbookSource'
import { pageOf, setProgress } from '../../data/handbookProgress'

const props = defineProps({
  // The whole book in reading order, each entry carrying `owned` and, when it is not,
  // `planName` — what it would take to open it. Locked chapters are listed, never loaded.
  // `freeUntil` is set on a chapter opened to everyone for a while, and only on the copy
  // handed to someone whose own plan does not already cover it.
  units: { type: Array, required: true },
  // Which one to open at.
  startId: { type: String, required: true },
  // Tiled faintly across every page. Not a lock — a reader can still photograph the screen —
  // but it makes a leaked copy say who leaked it, which is the part that actually changes
  // behaviour. Tiled and diagonal rather than tucked in a corner, because a corner mark is
  // removed by cropping or by trimming the margin off a printout.
  watermark: { type: String, default: '' }
})
const emit = defineEmits(['close', 'locked'])
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

// How many chapters keep their rasterised pages at once.
//
// The images are the expensive part by an order of magnitude: an A4 page at 1600px is roughly
// half a megabyte as a JPEG data URL, so an 18-page chapter is about 9 MB and a book chained
// end to end would be hundreds. iOS reloads a tab that asks for that. The source PDFs are
// kept instead — the whole 27-chapter book is about 14 MB of them — so a chapter scrolled
// back into re-rasterises without going near the network, which on venue wifi is the
// difference between instant and unusable.
const LIVE_CHAPTERS = 3

// Capped because a canvas that large is slow to paint and, on iOS, can fail outright — the
// same ceiling the image export ran into.
const MAX_CANVAS_WIDTH = 1600

const scrollerRef = ref(null)
const showToc = ref(false)
const tocTab = ref('contents')

/**
 * The chapters currently stacked in the scroller, in reading order.
 *
 * Each is `{ unit, data, pages, status }` where `pages` is `[{ n, ratio, url }]`. A released
 * chapter keeps its page list and its ratios — so the boxes keep their exact heights and
 * nothing jumps — and only drops the `url`s.
 */
const chapters = shallowRef([])
const error = ref('')
const busy = ref(false)
const currentId = ref('')
const currentPage = ref(1)

const index = computed(() => props.units.findIndex(u => u.id === props.startId))
const current = computed(() => props.units.find(u => u.id === currentId.value) || props.units[index.value] || null)
const currentTotal = computed(() => {
  const c = chapters.value.find(c => c.unit.id === currentId.value)
  return c?.pages.length || current.value?.pages || 0
})
const toc = computed(() => current.value?.toc || [])

// The chapter after the last one stacked — what the foot of the book offers next.
const nextUnit = computed(() => {
  const last = chapters.value[chapters.value.length - 1]
  if (!last) return null
  const i = props.units.findIndex(u => u.id === last.unit.id)
  return i >= 0 ? props.units[i + 1] || null : null
})

let token = 0

/** Fetch a chapter's PDF once and keep the bytes; rasterising can then happen repeatedly. */
async function bytesFor(entry) {
  if (entry.data) return entry.data
  const data = await fetchUnit(entry.unit.id)
  // pdf.js detaches the buffer it is handed, so the retained copy has to be a separate one —
  // otherwise re-rasterising a chapter scrolled back into finds an empty ArrayBuffer.
  entry.data = data
  return data
}

async function rasterise(entry, mine) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  // Vite bundles the worker from the package rather than a CDN: the artifact CSP aside,
  // this app has to keep working offline-ish on venue wifi.
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  GlobalWorkerOptions.workerSrc = worker.default

  const data = await bytesFor(entry)
  if (mine !== token) return
  const doc = await getDocument({ data: data.slice(0) }).promise
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      if (mine !== token) return
      const base = page.getViewport({ scale: 1 })
      const target = Math.min(window.innerWidth * (window.devicePixelRatio || 1), MAX_CANVAS_WIDTH)
      const viewport = page.getViewport({ scale: target / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      stamp(ctx, canvas.width, canvas.height, props.watermark)
      const url = canvas.toDataURL('image/jpeg', 0.86)
      const ratio = viewport.height / viewport.width
      const existing = entry.pages[n - 1]
      if (existing) Object.assign(existing, { url, ratio })
      else entry.pages.push({ n, url, ratio })
      chapters.value = [...chapters.value]
    }
    entry.status = 'ready'
  } finally {
    doc.destroy?.()
  }
}

/**
 * Drop the images of chapters far enough from the one being read.
 *
 * Only the `url`s go. The page boxes stay, at their measured ratios, so releasing a chapter
 * above the viewport does not shorten the document under the reader's thumb.
 */
function trim() {
  const live = chapters.value.findIndex(c => c.unit.id === currentId.value)
  chapters.value.forEach((c, i) => {
    const far = Math.abs(i - live) >= LIVE_CHAPTERS
    if (far && c.status === 'ready') {
      c.pages.forEach(p => { p.url = null })
      c.status = 'released'
    }
  })
}

async function load(entry) {
  if (busy.value) return
  busy.value = true
  const mine = token
  try {
    entry.status = 'loading'
    chapters.value = [...chapters.value]
    await rasterise(entry, mine)
    if (mine === token) trim()
  } catch (e) {
    if (mine !== token) return
    entry.status = 'error'
    error.value = e.message === 'locked' ? t('handbook.locked') : t('handbook.loadFailed')
  } finally {
    busy.value = false
  }
}

function entryFor(unit) {
  return { unit, data: null, pages: [], status: 'idle' }
}

/** Open at one chapter, discarding whatever was stacked before. */
async function openAt(unit) {
  token++
  error.value = ''
  showToc.value = false
  currentId.value = unit.id
  currentPage.value = 1
  const entry = entryFor(unit)
  chapters.value = [entry]
  await load(entry)
  restore(unit.id)
}

/** Append the next chapter under the current stack. Locked chapters are never loaded. */
async function loadNext() {
  const u = nextUnit.value
  if (!u || !u.owned || busy.value) return
  const entry = entryFor(u)
  chapters.value = [...chapters.value, entry]
  await load(entry)
}

function onScroll() {
  const el = scrollerRef.value
  if (!el) return
  const mid = el.scrollTop + el.clientHeight / 2

  // Which chapter the reader is in, and which page of it — read off the DOM rather than
  // tracked, because the heights differ per page and per zoom.
  let seen = 0
  for (const c of chapters.value) {
    const kids = [...el.querySelectorAll(`[data-ch="${c.unit.id}"] .hr-page`)]
    if (!kids.length) continue
    const top = kids[0].offsetTop
    const bottom = kids[kids.length - 1].offsetTop + kids[kids.length - 1].offsetHeight
    if (mid >= top && mid < bottom) {
      const i = kids.findIndex(k => k.offsetTop + k.offsetHeight > mid)
      currentPage.value = (i === -1 ? kids.length : i + 1) || 1
      if (currentId.value !== c.unit.id) {
        currentId.value = c.unit.id
        trim()
      }
      setProgress(c.unit.id, currentPage.value, kids.length)
      break
    }
    seen++
  }

  // A chapter scrolled back into has to come back. Re-rasterised from the retained bytes,
  // so this costs no network.
  const here = chapters.value.find(c => c.unit.id === currentId.value)
  if (here && here.status === 'released' && !busy.value) load(here)

  // Near the foot: pull the next chapter in. One viewport of lead time, which at reading
  // speed is far enough ahead that the join is not noticed.
  if (el.scrollHeight - (el.scrollTop + el.clientHeight) < el.clientHeight) loadNext()
}

function goTo(page) {
  showToc.value = false
  const el = scrollerRef.value?.querySelector(`[data-ch="${currentId.value}"]`)
  el?.querySelectorAll('.hr-page')[page - 1]?.scrollIntoView({ block: 'start' })
}

/** Pick up where this chapter was left off. */
function restore(unitId) {
  const page = pageOf(unitId)
  if (page <= 1) return
  requestAnimationFrame(() => {
    const el = scrollerRef.value?.querySelector(`[data-ch="${unitId}"]`)
    el?.querySelectorAll('.hr-page')[page - 1]?.scrollIntoView({ block: 'start' })
  })
}

function pickChapter(u) {
  if (!u.owned) {
    showToc.value = false
    emit('locked', u)
    return
  }
  openAt(u)
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (showToc.value) showToc.value = false
    else emit('close')
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  // The page behind must not scroll while a full-screen reader is open.
  document.body.style.overflow = 'hidden'
  const start = props.units[index.value]
  if (start) openAt(start)
})
onBeforeUnmount(() => {
  token++
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
watch(() => props.startId, id => {
  const u = props.units.find(x => x.id === id)
  if (u && u.id !== currentId.value) openAt(u)
})

// How the mark is inked.
//
// It used to be flat black at 0.038 alpha, which read fine on a white page and vanished the
// moment the book grew an aged-paper background: measured, the stamp moves luminance by about
// 8/255 while the paper's own texture has a standard deviation of 45. The signal sat an order
// of magnitude under the noise.
//
// So it is no longer a grey veil over the page but brown ink multiplied into it — a stain
// rather than an overlay, which shifts hue as well as luminance and therefore reads against a
// textured ground at a far lower strength than flat black would need.
const MARK_INK = '#4A2E12'
const MARK_ANGLE = -Math.PI / 6
// Floor for flat white paper, where almost nothing is needed, and ceiling so a busy page can
// never turn the mark into something that competes with the text.
const MARK_ALPHA_MIN = 0.05
const MARK_ALPHA_MAX = 0.13

/**
 * How strongly this particular page has to be stamped.
 *
 * Tied to the page's own texture rather than fixed, because the right amount differs by an
 * order of magnitude between a white page and a parchment one — and the book has both. Tuning
 * a constant by eye would be tuning it for whichever page happened to be open.
 */
function inkStrength(ctx, width, height) {
  const step = Math.max(1, Math.floor(width / 120))
  let n = 0, sum = 0, sumSq = 0
  try {
    const { data } = ctx.getImageData(0, 0, width, height)
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        sum += l
        sumSq += l * l
        n++
      }
    }
  } catch (e) {
    // A tainted canvas cannot be read back. Fall back to the middle of the range rather than
    // leaving the page unmarked.
    return (MARK_ALPHA_MIN + MARK_ALPHA_MAX) / 2
  }
  if (!n) return MARK_ALPHA_MIN
  const mean = sum / n
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
  return Math.min(MARK_ALPHA_MAX, Math.max(MARK_ALPHA_MIN, 0.045 + sd / 255 * 0.3))
}

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
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = inkStrength(ctx, width, height)
  ctx.fillStyle = MARK_INK
  ctx.font = `700 ${Math.round(width * 0.04)}px "Hiragino Sans", system-ui, sans-serif`
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
</script>

<template>
  <Teleport to="body">
    <div class="hr">
      <header class="hr-bar">
        <button class="hr-close" :aria-label="t('common.back')" @click="emit('close')">✕</button>
        <div class="hr-titlebox">
          <div class="hr-title">{{ current?.title }}</div>
          <!-- 只對「自己方案沒涵蓋這一章」的人顯示。對已經買到的人來說這不是優惠，
               講了只會讓人覺得自己付的錢買到了別人免費就有的東西。 -->
          <div v-if="current?.freeUntil" class="hr-free">
            {{ t('handbook.freeRead') }} · {{ t('handbook.freeUntil', { date: current.freeUntil }) }}
          </div>
        </div>
        <button
          class="hr-tocbtn"
          :class="{ on: showToc }"
          :aria-label="t('handbook.contents')"
          @click="showToc = !showToc"
        >☰</button>
        <div class="hr-zoom">
          <button :disabled="!canZoomOut" :aria-label="t('handbook.zoomOut')" @click="stepZoom(-1)">−</button>
          <span class="hr-zoom-val">{{ Math.round(zoom * 100) }}%</span>
          <button :disabled="!canZoomIn" :aria-label="t('handbook.zoomIn')" @click="stepZoom(1)">＋</button>
        </div>
        <div class="hr-count">{{ currentTotal ? `${currentPage} / ${currentTotal}` : '' }}</div>
      </header>

      <!-- A sheet rather than a side panel: it is a jump list used for a second and
           dismissed, and on a phone there is no side to put it on.

           Two tabs rather than two icons in the bar. The bar already carries close, title,
           zoom and a page count; a seventh control there is a control nobody can hit. -->
      <div v-if="showToc" class="hr-toc" @click.self="showToc = false">
        <div class="hr-toc-sheet">
          <div class="hr-tabs">
            <button
              class="hr-tab"
              :class="{ on: tocTab === 'contents' }"
              :disabled="!toc.length"
              @click="tocTab = 'contents'"
            >{{ t('handbook.contents') }}</button>
            <button
              class="hr-tab"
              :class="{ on: tocTab === 'chapters' }"
              @click="tocTab = 'chapters'"
            >{{ t('handbook.chapters') }}</button>
          </div>

          <template v-if="tocTab === 'contents'">
            <button
              v-for="(e, i) in toc"
              :key="i"
              class="hr-toc-row"
              :class="{ on: currentPage >= e.page && (!toc[i + 1] || currentPage < toc[i + 1].page) }"
              @click="goTo(e.page)"
            >
              <span>{{ e.title }}</span>
              <span class="hr-toc-pg">{{ e.page }}</span>
            </button>
          </template>

          <!-- The whole book, locks included. A list that hid what is not owned would be a
               list that cannot say what the subscription is for. -->
          <template v-else>
            <button
              v-for="u in units"
              :key="u.id"
              class="hr-toc-row"
              :class="{ on: u.id === currentId, locked: !u.owned }"
              @click="pickChapter(u)"
            >
              <span class="hr-ch-title">{{ u.title }}</span>
              <span v-if="u.freeUntil" class="hr-ch-free">{{ t('handbook.freeRead') }}</span>
              <span v-else-if="!u.owned" class="hr-ch-lock">{{ u.planName || t('handbook.lockedShort') }}</span>
              <span v-else class="hr-toc-pg">{{ t('handbook.pages', { n: u.pages }) }}</span>
            </button>
          </template>
        </div>
      </div>

      <div v-if="error && !chapters.length" class="hr-state">{{ error }}</div>
      <div v-else-if="!chapters.length" class="hr-state">{{ t('handbook.loading') }}</div>

      <div
        v-else
        ref="scrollerRef"
        class="hr-scroll"
        :style="{ '--z': zoom }"
        @scroll.passive="onScroll"
      >
        <section v-for="c in chapters" :key="c.unit.id" :data-ch="c.unit.id">
          <!-- Named at the join. Without it a chapter boundary in a continuous scroll is
               invisible, and the reader cannot tell which book the page belongs to. -->
          <div class="hr-join">{{ c.unit.title }}</div>
          <div v-for="p in c.pages" :key="p.n" class="hr-page" :style="{ aspectRatio: `1 / ${p.ratio}` }">
            <img v-if="p.url" :src="p.url" :alt="`${c.unit.title} ${p.n}`" draggable="false">
          </div>
          <div v-if="c.status === 'loading'" class="hr-more">{{ t('handbook.loadingMore') }}</div>
          <div v-else-if="c.status === 'error'" class="hr-more">{{ error }}</div>
        </section>

        <!-- The foot of the book. Three answers, and the locked one is the only place in the
             reader that mentions a plan — mid-scroll is the moment the next chapter is worth
             something, so it is the one place the ask is not an interruption. -->
        <div class="hr-foot">
          <template v-if="nextUnit && nextUnit.owned">
            <div class="hr-foot-label">{{ t('handbook.nextUp') }}</div>
            <button class="hr-foot-cta" @click="loadNext">{{ nextUnit.title }}</button>
          </template>
          <template v-else-if="nextUnit">
            <div class="hr-foot-label">{{ t('handbook.nextLocked', { n: nextUnit.title }) }}</div>
            <button class="hr-foot-cta" @click="emit('locked', nextUnit)">
              {{ nextUnit.planName || t('handbook.needPlanShort') }}
            </button>
          </template>
          <div v-else class="hr-foot-label">{{ t('handbook.lastChapter') }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Viewport units, not rem — see the note at the top: this screen is outside #stage, and the
   root font-size belongs to the stage. */
.hr {
  zoom: var(--hb-scale, 1);
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
/* 六樣東西（關閉、書名、目錄、縮放、頁碼）在一支手機的寬度裡排不下一行 —— 排不下時
   書名會被擠成一個字一行的直書。讓它換行：書名佔滿第一行，操作鍵退到第二行，兩邊都
   還讀得到。 */
.hr-bar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
  padding: max(16px, calc(env(safe-area-inset-top) / var(--hb-scale, 1))) 24px 16px;
  background: #1F1F1D;
  color: #fff;
}
.hr-close {
  flex: none;
  width: 64px;
  height: 64px;
  border: 0;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 32px;
  cursor: pointer;
}
.hr-titlebox { flex: 1 1 220px; min-width: 0; }
.hr-title { font-size: 30px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-free {
  font-size: 20px; font-weight: 700; letter-spacing: 0.04em; color: #E8B57A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hr-ch-free {
  flex: none;
  padding: 4px 14px;
  border-radius: 999px;
  background: #A8571F;
  color: #FFF;
  font-size: 20px;
  font-weight: 700;
}
.hr-tocbtn {
  flex: none;
  width: 60px;
  height: 60px;
  border: 0;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 28px;
  cursor: pointer;
}
.hr-tocbtn.on { background: #F0E4CC; color: #2C2117; }

.hr-toc {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(20, 16, 10, 0.55);
  display: flex;
  align-items: flex-end;
}
.hr-toc-sheet {
  width: 100%;
  max-height: 70%;
  overflow-y: auto;
  padding: 28px 32px calc(36px + calc(env(safe-area-inset-bottom) / var(--hb-scale, 1)));
  background: #EDE0C8;
  color: #3E2F22;
  font-family: var(--ui-cjk);
}
.hr-toc-head {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.26em;
  color: #7A6753;
  padding-bottom: 16px;
  border-bottom: 1px solid #C3A77F;
}
.hr-toc-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  padding: 22px 4px;
  border: 0;
  border-bottom: 1px solid rgba(195, 167, 127, 0.45);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 30px;
  text-align: left;
  cursor: pointer;
}
/* Which section the reader is actually in — the thing a jump list is usually missing. */
.hr-toc-row.on { font-weight: 700; }
.hr-toc-row.on::before { content: "❯"; font-size: 18px; margin-right: 12px; }
.hr-toc-pg { flex: none; font-size: 24px; color: #7A6753; font-variant-numeric: tabular-nums; }

.hr-zoom { flex: none; display: flex; align-items: center; gap: 4px; }
.hr-zoom button {
  width: 60px;
  height: 60px;
  border: 0;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
}
.hr-zoom button:disabled { opacity: .35; cursor: default; }
.hr-zoom-val {
  min-width: 84px;
  text-align: center;
  font-size: 22px;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}
.hr-count { flex: none; font-size: 24px; color: rgba(255, 255, 255, 0.7); font-variant-numeric: tabular-nums; }

/* Horizontal scrolling appears only once zoomed past the frame. */
.hr-scroll { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }
/* Both dimensions scale, or the comfortable-reading cap silently wins and the + button does
   nothing on a wide screen — which is exactly what it did the first time. */
.hr-page {
  position: relative;
  margin: 0 auto 20px;
  width: calc(100% * var(--z, 1));
  max-width: calc(1800px * var(--z, 1));
}
.hr-page img { display: block; width: 100%; height: auto; }
.hr-state, .hr-more {
  padding: 64px 40px;
  text-align: center;
  color: rgba(255, 255, 255, 0.75);
  font-size: 28px;
}

/* Two tabs, because the sheet now answers both "where am I in this chapter" and "take me to
   another one". */
.hr-tabs { display: flex; gap: 12px; padding-bottom: 20px; border-bottom: 1px solid #C3A77F; }
.hr-tab {
  flex: 1;
  padding: 14px 20px;
  border: 1px solid #C3A77F;
  border-radius: 14px;
  background: none;
  color: #7A6753;
  font: inherit;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.hr-tab.on { background: #3E2F22; border-color: #3E2F22; color: #F0E4CC; }
.hr-tab:disabled { opacity: .4; cursor: default; }

.hr-ch-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-toc-row.locked { color: #9A8771; }
.hr-ch-lock {
  flex: none;
  padding: 4px 14px;
  border-radius: 999px;
  background: rgba(62, 47, 34, 0.1);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

/* Where one chapter ends and the next begins. In a continuous scroll this is the only thing
   telling the reader the book moved on. */
.hr-join {
  margin: 0 auto 20px;
  padding: 14px 24px;
  max-width: calc(1800px * var(--z, 1));
  width: calc(100% * var(--z, 1));
  border-radius: 16px;
  background: rgba(240, 228, 204, 0.1);
  color: rgba(255, 255, 255, 0.72);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-align: center;
}
/* The first chapter in the stack is the one the reader opened on purpose; its name is already
   in the bar above. */
.hr-scroll > section:first-child .hr-join { display: none; }

/* A released chapter keeps its box so nothing jumps; this is what that box looks like. */
.hr-page { background: rgba(255, 255, 255, 0.04); }

.hr-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 56px 40px calc(80px + calc(env(safe-area-inset-bottom) / var(--hb-scale, 1)));
}
.hr-foot-label { color: rgba(255, 255, 255, 0.6); font-size: 26px; text-align: center; }
.hr-foot-cta {
  padding: 20px 44px;
  border: 0;
  border-radius: 999px;
  background: #F0E4CC;
  color: #2C2117;
  font: inherit;
  font-size: 28px;
  font-weight: 800;
  cursor: pointer;
}
</style>
