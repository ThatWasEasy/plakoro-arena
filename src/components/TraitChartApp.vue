<script setup>
// A character's five ratings as a radar chart: pick from the list on the left, read the shape
// on the right.
//
// The chart exists for comparison by silhouette — a spiky figure and a round one are different
// kinds of character before a single number is read. That only works if the axes stay in the
// same places, so their order is fixed by the data rather than by anything on this screen.
//
// 所有人都看得到，只有後台改得動。改的時候就在這張圖上改 —— 不是另開一個後台畫面：
// 數值唯一的意義是那個形狀，填的人跟看的人盯著同一張圖，才不會發生「後台調完不知道
// 玩家看到什麼」。
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor, typeChipColor } from '../data/constants'
import { asset } from '../data/assetPath'
import {
  TRAIT_AXES, TRAIT_MAX, TRAIT_MIN, TRAIT_STEP,
  applyTraits, characterTraits, hasTraits, refreshCharacterTraits, traitsOf
} from '../data/characterTraits'
import { adminToken, isAdminMode } from '../data/adminSession'
import { saveCharacterTraits } from '../data/adminApi'

const emit = defineEmits(['back'])
const { characters } = inject('characterData')
const { t } = useI18n()

const selectedId = ref(null)

refreshCharacterTraits()

// Opens on the first character rather than an empty panel — the chart is the point of the
// screen, and an empty one makes it look broken before it has been used.
watch(characters, list => {
  if (!selectedId.value && list.length) selectedId.value = list[0].id
}, { immediate: true })

const selected = computed(() => characters.value.find(c => c.id === selectedId.value) || null)

// 存起來的那一份。
const stored = computed(() => (selected.value ? traitsOf(selected.value.id) : null))

// 後台模式下正在調的那一份。圖畫的是它，所以每按一下＋，形狀當場就動 —— 存檔前就看得到
// 自己調成什麼樣子。
const draft = ref({})
const zeros = () => Object.fromEntries(TRAIT_AXES.map(a => [a, 0]))
watch([selectedId, characterTraits, isAdminMode], () => {
  draft.value = stored.value || zeros()
}, { immediate: true })

const traits = computed(() => (isAdminMode.value ? draft.value : stored.value))

// 還沒填過的那幾隻在後台模式下從 0 開始，所以「全 0」要當成沒改過，不然一進畫面存檔鍵
// 就亮著，一按就把一隻沒評過的角色評成四個 0。
const dirty = computed(() => {
  const base = stored.value || zeros()
  return TRAIT_AXES.some(a => draft.value[a] !== base[a])
})

const saving = ref(false)
const saveError = ref('')

function bump(axis, delta) {
  const v = Math.min(TRAIT_MAX, Math.max(TRAIT_MIN, (draft.value[axis] || 0) + delta))
  draft.value = { ...draft.value, [axis]: v }
}

async function save() {
  if (!selected.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    const payload = { ...draft.value }
    await saveCharacterTraits(adminToken.value, selected.value.id, payload)
    applyTraits(selected.value.id, payload)
  } catch (e) {
    saveError.value = e.message
  } finally {
    saving.value = false
  }
}

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
//
// 留白是按最吃邊的軸數抓的：四根軸時左右兩個標籤正好落在水平線上（cos = ±1），量出來
// 最長的那個（「爆擊 4.5」）右緣在 126，所以要 28。六根軸的標籤是斜的、沒那麼外面，
// 但留白留著就好 —— 軸數之後還會動，抓最壞的情況比每次改軸都要重算安全。
const PAD = Math.ceil(LABEL_SIZE * 4)
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

/**
 * 把畫面上那張圖變成一張 <img>。
 *
 * 現場那個 SVG 靠 scoped 樣式與 CSS 變數上色，兩者都活不過「被抽離文件」這一步，所以
 * 每一個會上色的屬性都要從 computed style 讀出來、寫回 clone 身上。
 */
async function chartToImage(size) {
  const live = chartEl.value
  if (!live) return null
  const clone = live.cloneNode(true)
  inlineStyles(live, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  // The export's viewBox is measured, not guessed. Labels sit outside the chart and their
  // width depends on the font and the language — estimating it left the right-hand labels
  // cropped. getBBox reports what the browser actually laid out, including the text.
  const bb = live.getBBox()
  const m = 2
  const vw = bb.width + m * 2, vh = bb.height + m * 2
  clone.setAttribute('viewBox', `${bb.x - m} ${bb.y - m} ${vw} ${vh}`)

  // Square output, with the measured content centred in it.
  const scale = size / Math.max(vw, vh)
  const w = Math.round(vw * scale)
  const h = Math.round(vh * scale)
  clone.setAttribute('width', w)
  clone.setAttribute('height', h)

  const svg = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  // Base64 rather than a blob URL: a blob URL taints the canvas in some browsers, and a
  // tainted canvas cannot be read back out as a PNG.
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
  return { img, w, h }
}

/** 畫面上那張圖，鋪上底色之後的 PNG。 */
async function chartBlob(size) {
  const shot = await chartToImage(size)
  if (!shot) return null
  const canvas = document.createElement('canvas')
  canvas.width = shot.w
  canvas.height = shot.h
  const ctx = canvas.getContext('2d')
  // A ground rather than transparency: the labels are dark, and a transparent PNG of dark
  // text disappears the moment it is dropped on anything dark.
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#fff'
  ctx.fillRect(0, 0, shot.w, shot.h)
  ctx.drawImage(shot.img, 0, 0, shot.w, shot.h)
  return new Promise(r => canvas.toBlob(r, 'image/png'))
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const SIZE = 1200
const fileName = name => `${name}-traits.png`

async function saveChart() {
  if (exporting.value || exportingAll.value) return
  exporting.value = true
  try {
    const blob = await chartBlob(SIZE)
    if (blob) saveBlob(blob, fileName(selected.value.name))
  } finally {
    exporting.value = false
  }
}

/**
 * 每一隻各一張，一次下載完。
 *
 * 不是拼成一張大圖 —— 這些圖是要放進書裡不同位置的，拼起來等於還要再裁一次。
 *
 * 做法是把選擇一隻一隻換過去，每換一隻就把現場那張圖拍下來。看起來繞，但它讓整批匯出
 * 跟單張匯出共用同一條路徑；另外寫一份「不靠畫面的繪圖」會變成同一張圖的第二份實作，
 * 而兩份實作會走鐘。
 *
 * 還沒填數值的角色跳過：全零的五角形會被讀成「這隻每一項都很爛」，那不是沒填的意思。
 */
const exportingAll = ref(false)
const exportedCount = ref(0)

async function saveAll() {
  if (exporting.value || exportingAll.value) return
  const list = characters.value.filter(c => hasTraits(c.id))
  if (!list.length) return
  exportingAll.value = true
  exportedCount.value = 0
  const keep = selectedId.value
  try {
    for (const c of list) {
      selectedId.value = c.id
      // 等畫面真的換過去，拍到的才是這一隻 —— 少了這一行會連拍 23 張同一個人。
      await nextTick()
      const blob = await chartBlob(SIZE)
      if (!blob) continue
      saveBlob(blob, fileName(c.name))
      exportedCount.value += 1
      // 瀏覽器對「連續觸發下載」有節流，擠在同一個 tick 會掉檔案。
      await new Promise(r => setTimeout(r, 300))
    }
  } finally {
    selectedId.value = keep
    exportingAll.value = false
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

          <!-- Said plainly rather than drawn as zeros: an all-zero shape would read as a
               rating of "bad at everything", which is not what a missing row means.
               後台模式下不會走到這裡 —— 那邊要的就是一張從 0 開始、可以調的圖。 -->
          <div v-else class="tc-empty">{{ t('traitChart.noData') }}</div>

          <!-- 只有後台看得到。四排就在圖的正下方，按一下形狀就動。 -->
          <div v-if="isAdminMode" class="tc-edit">
            <div v-for="axis in TRAIT_AXES" :key="axis" class="tc-row">
              <span class="tc-row-name">{{ t('traitChart.axis.' + axis) }}</span>
              <button
                class="tc-step"
                :disabled="draft[axis] <= TRAIT_MIN"
                @click="bump(axis, -TRAIT_STEP)"
              >−</button>
              <span class="tc-row-val">{{ fmt(draft[axis]) }}</span>
              <button
                class="tc-step"
                :disabled="draft[axis] >= TRAIT_MAX"
                @click="bump(axis, TRAIT_STEP)"
              >＋</button>
            </div>
            <p v-if="saveError" class="tc-err">{{ saveError }}</p>
          </div>
        </template>
      </div>
    </div>

    <div class="tc-foot">
      <button
        v-if="isAdminMode"
        class="btn"
        :disabled="!dirty || saving"
        @click="save"
      >{{ saving ? t('traitChart.savingValues') : t('common.save') }}</button>
      <button
        v-if="traits"
        class="btn secondary"
        :disabled="exporting || exportingAll"
        @click="saveChart"
      >{{ exporting ? t('traitChart.saving') : t('traitChart.saveImage') }}</button>
      <!-- 每一隻各一張，不是拼成一張大圖：這些圖要放進書裡不同位置。 -->
      <button
        class="btn secondary"
        :disabled="exporting || exportingAll"
        @click="saveAll"
      >{{ exportingAll ? `${exportedCount}/${characters.length}` : t('traitChart.saveAll') }}</button>
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

/* --- 後台的調整列 --- */
.tc-edit { width: 100%; max-width: 19rem; display: flex; flex-direction: column; gap: 0.25rem; }
.tc-row { display: flex; align-items: center; gap: 0.375rem; }
.tc-row-name { flex: 1; font-size: 0.75rem; font-weight: 800; color: var(--ink); }
.tc-row-val {
  width: 2rem;
  text-align: center;
  font-size: 0.8125rem;
  font-weight: 900;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.tc-step {
  width: 1.75rem;
  height: 1.75rem;
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 0.375rem;
  background: var(--card);
  color: var(--ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
}
.tc-step:disabled { opacity: 0.3; cursor: not-allowed; }
.tc-err { margin: 0.25rem 0 0; font-size: 0.625rem; font-weight: 800; color: #C0392B; }

/* 全域的 .btn 沒有停用的樣子（它原本只用在一定按得下去的地方），所以在這裡補：
   沒改過東西的時候儲存鍵看起來要跟按得下去不一樣。 */
.tc-foot .btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tc-foot .btn:disabled:active { transform: none; }

/* 四顆按鈕（管理員模式下）在 430px 寬放不下一排，所以讓它換行，不是讓它擠。 */
.tc-foot {
  display: flex; flex-wrap: wrap; gap: 0.625rem; justify-content: center;
  padding: 0.75rem 0 0.25rem; flex-shrink: 0;
}
</style>
