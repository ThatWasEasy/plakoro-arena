<script setup>
// "How many boxes do I need to actually build this?" — the question the builder can't answer,
// because it lets you assemble any die without asking whether the parts exist on your table.
//
// Inventory is entered as boxes owned, not pieces owned. Nobody remembers how many 火 chips they
// have, but everyone remembers buying two Charmander sets — and a box converts to pieces exactly,
// so the less painful input is also the more reliable one.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PRODUCT_PARTS, TYPE_TO_ZH, isReleased, releaseIsMonthOnly } from '../../data/productParts'
import { requiredParts, shortfall, planWithUpcoming, totalPieces, unbuyableParts } from '../../game/dicePartsPlan'
import ChipIcon from './ChipIcon.vue'

const props = defineProps({
  sets: { type: Array, required: true },
  setLabels: { type: Array, required: true }
})
defineEmits(['back'])
const { t, locale } = useI18n()

const OWNED_KEY = 'plakoro_owned_boxes_v1'

// Which dice set the plan is for. Comparing two builds is the builder's job; costing them is
// one at a time, since you buy for the set you intend to use.
const activeSet = ref(0)
watch(() => props.sets.length, n => { if (activeSet.value >= n) activeSet.value = 0 })

// Boxes owned, keyed by product. Persisted because it describes a physical shelf, not a session.
const owned = ref(loadOwned())

function loadOwned() {
  try {
    const raw = localStorage.getItem(OWNED_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    return {}
  }
}
function persist() {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned.value)) } catch (e) {}
}
function addBox(key, delta) {
  const next = Math.max(0, (owned.value[key] || 0) + delta)
  if (next === 0) delete owned.value[key]
  else owned.value[key] = next
  persist()
}
function clearOwned() {
  owned.value = {}
  persist()
}

// The inventory list stays complete — an unreleased box is one you can't own yet, but an import
// or an early copy isn't the planner's business to disallow. Only the recommendation is gated.
const buyable = computed(() => PRODUCT_PARTS.filter(p => p.status === 'confirmed'))
// Grouped so the grid can carry a heading per kind — the categories are what a player thinks in
// ("do I need another starter, or a small box?"), and the heading lets each tile drop the prefix.
const CATEGORY_ORDER = ['starter', 'expeditionSmall', 'dx']
const ownedGroups = computed(() =>
  CATEGORY_ORDER
    .map(cat => ({ cat, items: buyable.value.filter(p => p.category === cat) }))
    .filter(g => g.items.length))

// Collapsed by default once something is recorded: the list is 16 tiles and its job is done as
// soon as it's filled in, so it shouldn't keep pushing the actual answer off the screen.
const ownedOpen = ref(false)

// Which product's contents are being inspected. The grid tile only has room for a name and a
// count, but "what's actually in this box" is the question that decides whether to buy it — so
// it gets a sheet of its own rather than being crammed in or left out.
const inspecting = ref(null)

function releaseLabel(p) {
  if (isReleased(p, now())) return ''
  const [y, m] = p.release.split('-')
  return releaseIsMonthOnly(p)
    ? t('partsPlan.releaseMonth', { y, m: Number(m) })
    : t('partsPlan.releaseDate', { date: p.release })
}
const ownedTotal = computed(() => Object.values(owned.value).reduce((a, b) => a + b, 0))

// Boxes owned, expanded into the pieces they contain.
const ownedParts = computed(() => {
  const acc = { convex: {}, concave: {}, single: {}, dual: {} }
  buyable.value.forEach(p => {
    const qty = owned.value[p.key] || 0
    if (!qty) return
    ;['convex', 'concave', 'single', 'dual'].forEach(kind => {
      Object.entries(p[kind] || {}).forEach(([type, n]) => {
        acc[kind][type] = (acc[kind][type] || 0) + n * qty
      })
    })
  })
  return acc
})

const need = computed(() => requiredParts(props.sets[activeSet.value] ? props.sets[activeSet.value].dice : []))
const gap = computed(() => shortfall(need.value, ownedParts.value))
// Evaluated once per render rather than captured at mount: a session left open across a release
// date should start recommending the new box, not keep hiding it.
const now = () => new Date()
// Spread the purchase across different sets. Some players are collecting the figures and would
// rather have three different boxes than three of one; this only ever chooses between answers
// that cost the same, so ticking it can never make the trip more expensive.
const preferVariety = ref(false)
const plans = computed(() => planWithUpcoming(gap.value, { asOf: now(), preferVariety: preferVariety.value }))
const plan = computed(() => plans.value.now)
const missing = computed(() => unbuyableParts(gap.value, PRODUCT_PARTS, now()))
const nothingToBuy = computed(() => totalPieces(gap.value) === 0)

// Rows for a parts table: one line per distinct piece, with the wildcard halves last since
// "any concave" is a weaker statement than a named type and reads better after the specifics.
function partRows(parts) {
  const rows = []
  const push = (kind, key, n) => rows.push({ kind, key, n })
  ;['convex', 'concave', 'single', 'dual'].forEach(kind => {
    Object.entries(parts[kind] || {})
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, n]) => push(kind, key, n))
  })
  if (parts.convexAny) push('convexAny', null, parts.convexAny)
  if (parts.concaveAny) push('concaveAny', null, parts.concaveAny)
  return rows
}

const needRows = computed(() => partRows(need.value))

// A dual chip's key is "typeA+typeB"; both halves get an icon so a same-type chip reads as the
// single printed piece it is rather than as two separate chips.
function iconsFor(row) {
  if (row.kind === 'convexAny' || row.kind === 'concaveAny') return []
  return row.key.split('+')
}

// Expands the counts into one entry per physical piece, so the sheet can just show the pieces.
// Three 火 single chips read faster as three 火 icons than as one icon and "×3" — the box holds
// three things, and the row should look like three things.
function piecesOf(product, kind) {
  const out = []
  Object.entries(product[kind] || {}).forEach(([key, n]) => {
    for (let i = 0; i < n; i++) out.push(key.split('+'))
  })
  return out
}

const PIECE_KINDS = ['convex', 'concave', 'single', 'dual']

function partLabel(row) {
  if (row.kind === 'convexAny') return t('partsPlan.anyConvex')
  if (row.kind === 'concaveAny') return t('partsPlan.anyConcave')
  return t('partsPlan.kind.' + row.kind)
}

// The source data names types in Chinese; show that only where the UI language is Chinese, and
// fall back to the icon alone elsewhere rather than printing a language the reader can't use.
function typeText(type) {
  return locale.value.startsWith('zh') ? (TYPE_TO_ZH[type] || type) : ''
}
</script>

<template>
  <div class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('partsPlan.title') }}</div>

    <div style="width:100%; max-width:34rem; padding:0 0.75rem 0.5rem; display:flex; flex-direction:column; gap:0.75rem;">
      <!-- which build we're costing -->
      <div v-if="sets.length > 1" style="display:flex; gap:0.5rem; justify-content:center;">
        <button
          v-for="(label, si) in setLabels"
          :key="si"
          :class="['btn', activeSet === si ? '' : 'secondary']"
          style="padding:0.375rem 0.75rem; font-size:0.75rem;"
          @click="activeSet = si"
        >{{ t('diceBuilder.set', { label }) }}</button>
      </div>

      <!-- what the build needs -->
      <section>
        <div style="display:flex; align-items:baseline; gap:0.375rem; padding-bottom:0.25rem;">
          <span style="font-size:0.8125rem; font-weight:800; color:var(--ink);">{{ t('partsPlan.needTitle') }}</span>
          <span style="font-size:0.625rem; color:var(--sub); font-weight:700;">{{ t('partsPlan.pieces', { n: totalPieces(need) }) }}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.1875rem;">
          <div
            v-for="(row, i) in needRows"
            :key="i"
            style="display:flex; align-items:center; gap:0.375rem; background:var(--card); border-radius:0.5rem; padding:0.3125rem 0.5rem;"
          >
            <span style="font-size:0.625rem; font-weight:800; color:var(--sub); width:4.5rem; flex-shrink:0;">{{ partLabel(row) }}</span>
            <ChipIcon v-if="iconsFor(row).length" :types="iconsFor(row)" :size="1.375" />
            <span style="font-size:0.6875rem; color:var(--sub); font-weight:700; flex:1; min-width:0;">
              {{ iconsFor(row).map(typeText).filter(Boolean).join('+') }}
            </span>
            <span style="font-size:0.8125rem; font-weight:900; color:var(--ink);">×{{ row.n }}</span>
          </div>
        </div>
      </section>

      <!-- what you already own, entered as boxes -->
      <section>
        <div
          style="display:flex; align-items:center; gap:0.375rem; padding-bottom:0.25rem; cursor:pointer;"
          @click="ownedOpen = !ownedOpen"
        >
          <span :style="{ fontSize:'0.625rem', color:'var(--sub)', transform: ownedOpen ? 'rotate(90deg)' : 'none', transition:'transform .12s' }">▶</span>
          <span style="font-size:0.8125rem; font-weight:800; color:var(--ink); flex:1;">{{ t('partsPlan.ownedTitle') }}</span>
          <span style="font-size:0.625rem; color:var(--sub); font-weight:700;">{{ t('partsPlan.boxes', { n: ownedTotal }) }}</span>
          <button v-if="ownedTotal" class="btn secondary" style="padding:0.1875rem 0.4375rem; font-size:0.5625rem;" @click.stop="clearOwned">{{ t('partsPlan.clearOwned') }}</button>
        </div>

        <template v-if="ownedOpen">
          <div v-for="g in ownedGroups" :key="g.cat" style="padding-bottom:0.375rem;">
            <div style="font-size:0.5625rem; font-weight:800; color:var(--sub); padding:0.125rem 0 0.25rem;">{{ t('partsPlan.category.' + g.cat) }}</div>
            <!-- auto-fill rather than a fixed column count, so the tiles reflow instead of
                 overflowing when the stage is narrow -->
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(8.5rem, 1fr)); gap:0.25rem;">
              <div
                v-for="p in g.items"
                :key="p.key"
                :style="{
                  display:'flex', alignItems:'center', gap:'0.1875rem', borderRadius:'0.5rem',
                  padding:'0.1875rem 0.25rem', minWidth:0,
                  background: owned[p.key] ? 'rgba(174,255,62,.2)' : 'var(--card)'
                }"
              >
                <button class="btn secondary" style="padding:0.0625rem 0.3125rem; font-size:0.6875rem; flex-shrink:0; line-height:1.2;" @click="addBox(p.key, -1)">−</button>
                <span
                  style="flex:1; min-width:0; display:flex; align-items:baseline; gap:0.1875rem; justify-content:center; cursor:pointer;"
                  @click="inspecting = p"
                >
                  <span style="font-size:0.5625rem; font-weight:700; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ p.shortName }}</span>
                  <span style="font-size:0.75rem; font-weight:900; color:var(--ink); flex-shrink:0;">{{ owned[p.key] || 0 }}</span>
                </span>
                <button class="btn secondary" style="padding:0.0625rem 0.3125rem; font-size:0.6875rem; flex-shrink:0; line-height:1.2;" @click="addBox(p.key, 1)">+</button>
              </div>
            </div>
            <div v-if="g.items.some(p => releaseLabel(p))" style="font-size:0.5rem; color:var(--sub); font-weight:700; padding-top:0.1875rem;">
              <span v-for="p in g.items.filter(x => releaseLabel(x))" :key="p.key">{{ p.shortName }} {{ releaseLabel(p) }}　</span>
            </div>
          </div>
        </template>
      </section>

      <!-- the answer -->
      <section>
        <div style="font-size:0.8125rem; font-weight:800; color:var(--ink); padding-bottom:0.25rem;">{{ t('partsPlan.buyTitle') }}</div>

        <div v-if="nothingToBuy" style="font-size:0.75rem; font-weight:800; color:#4E9E6C; background:var(--card); border-radius:0.5rem; padding:0.625rem;">
          {{ t('partsPlan.alreadyHave') }}
        </div>

        <template v-else>
          <div style="display:flex; flex-direction:column; gap:0.1875rem;">
            <div
              v-for="b in plan.boxes"
              :key="b.product.key"
              style="display:flex; align-items:center; gap:0.5rem; background:var(--card); border-radius:0.5rem; padding:0.3125rem 0.5rem;"
            >
              <span style="font-size:0.875rem; font-weight:900; color:var(--ink); flex-shrink:0;">{{ b.qty }}×</span>
              <span style="font-size:0.6875rem; font-weight:700; color:var(--ink); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ b.product.name }}</span>
            </div>
          </div>
          <div style="font-size:0.875rem; font-weight:900; color:var(--ink); padding-top:0.375rem;">
            {{ t('partsPlan.total', { boxes: plan.totalBoxes }) }}
          </div>

          <label v-if="plan.totalBoxes > 1" style="display:flex; align-items:center; gap:0.3125rem; font-size:0.625rem; font-weight:700; color:var(--sub); cursor:pointer; padding-top:0.25rem;">
            <input type="checkbox" v-model="preferVariety" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('partsPlan.preferVariety') }}
            <!-- Says when the option has nothing left to give, rather than leaving a ticked box
                 that visibly did nothing. -->
            <span v-if="preferVariety && plan.maxCopies > 1" style="color:var(--ink); font-weight:800;">
              {{ t('partsPlan.varietyLimit', { n: plan.maxCopies }) }}
            </span>
          </label>
          <!-- The search is exhaustive unless it ran out of budget; say which, rather than let a
               "cheapest" label imply a guarantee that wasn't checked. -->
          <div v-if="!plan.optimal" style="font-size:0.5625rem; color:var(--sub); font-weight:700; padding-top:0.125rem;">
            {{ t('partsPlan.approximate') }}
          </div>

          <!-- Only shown when an announced box would genuinely do better; a future product that
               costs more is not worth telling anyone to wait for. -->
          <div v-if="plans.later" style="font-size:0.5625rem; color:var(--sub); font-weight:700; line-height:1.7; padding-top:0.375rem;">
            {{ t('partsPlan.laterOption', {
              names: plans.waitingFor.map(p => p.name + '（' + releaseLabel(p) + '）').join('、'),
              boxes: plans.later.totalBoxes
            }) }}
          </div>

          <div v-if="!plan.complete" style="font-size:0.625rem; font-weight:800; color:var(--danger); line-height:1.6; padding-top:0.375rem;">
            {{ t('partsPlan.unbuyable') }}
            <span v-for="(row, i) in partRows(missing)" :key="i">
              {{ i ? '、' : '' }}{{ iconsFor(row).map(typeText).filter(Boolean).join('+') || partLabel(row) }}×{{ row.n }}
            </span>
          </div>
        </template>
      </section>
    </div>

    <div style="display:flex; gap:0.625rem; justify-content:center; padding:0.5rem 0 0.25rem;">
      <button class="btn secondary" @click="$emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>

  <!-- One box's contents. Same row shape as the requirements list above, so the two read against
       each other: what this box gives you, in the units the plan asks for. -->
  <div v-if="inspecting" class="modal-overlay" @click.self="inspecting = null">
    <div class="modal-sheet" style="max-height:75%; position:relative;">
      <button
        @click="inspecting = null"
        style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer;"
      >✕</button>
      <div class="modal-title" style="padding-right:2rem;">{{ inspecting.name }}</div>
      <div style="font-size:0.625rem; color:var(--sub); font-weight:700; text-align:center; margin:-0.25rem 0 0.625rem;">
        {{ t('partsPlan.pieces', { n: totalPieces(inspecting) }) }}
        <span v-if="releaseLabel(inspecting)">・{{ releaseLabel(inspecting) }}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:0.375rem; overflow-y:auto;">
        <div v-for="kind in PIECE_KINDS" :key="kind" v-show="piecesOf(inspecting, kind).length">
          <div style="font-size:0.5625rem; font-weight:800; color:var(--sub); padding-bottom:0.1875rem;">{{ t('partsPlan.kind.' + kind) }}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.1875rem;">
            <ChipIcon v-for="(piece, i) in piecesOf(inspecting, kind)" :key="i" :types="piece" :size="1.5" />
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; justify-content:center; gap:0.5rem; padding-top:0.75rem;">
        <button class="btn secondary" style="padding:0.25rem 0.625rem;" @click="addBox(inspecting.key, -1)">−</button>
        <span style="font-size:1rem; font-weight:900; color:var(--ink); min-width:1.5rem; text-align:center;">{{ owned[inspecting.key] || 0 }}</span>
        <button class="btn secondary" style="padding:0.25rem 0.625rem;" @click="addBox(inspecting.key, 1)">+</button>
      </div>
    </div>
  </div>
</template>
