<!-- Admin-only：折扣碼。
     綠界沒有折扣碼這種機制 —— 金額是這邊自己算好才送出去的，所以這張表是唯一的真相，
     而且改一張碼不會動到已經成立的訂單：折抵金額在開單當下就寫死在那筆訂單上了。

     自己一個入口，不是塞在營收底下的一個分頁：營收那幾頁是在看「已經發生的事」，
     折扣碼是在「設定接下來會發生的事」 —— 要用到它的時候人是帶著目的來的（社團要開賣、
     要送一張碼給誰），不會先想到去翻報表。 -->
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  deleteHandbookCoupon, getHandbookTiers, listHandbookCouponUses, listHandbookCoupons,
  saveHandbookCoupon
} from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'

const emit = defineEmits(['back'])
const { t } = useI18n()

const coupons = ref([])
// 可以限定的對象，從同一份設定讀回來：方案是後台可以新增與改名的，期數是伺服器開單用的
// 那一份。寫死在這裡的話，加了一檔新方案之後這個畫面會少一個選項而且沒有人會發現。
const tierOptions = ref([])
const periodOptions = ref([])
const couponUses = ref({})     // code → 用過的人
const editing = ref(null)      // 正在編的那一張，null 代表在看列表
const busy = ref(false)
const error = ref('')

async function run(fn) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const load = () => run(async () => {
  const [list, cfg] = await Promise.all([
    listHandbookCoupons(adminToken.value),
    getHandbookTiers(adminToken.value)
  ])
  coupons.value = list.coupons
  // free 不是一檔商品，沒有人會拿折扣碼去結帳一個零元的方案。
  tierOptions.value = (cfg.tiers || []).filter(x => x.key !== 'free')
  periodOptions.value = cfg.periods || []
})
load()

/**
 * datetime-local 的值 ⇄ 伺服器的時間戳。
 *
 * 轉換在瀏覽器做，因為「11/15 20:00」指的是填的人所在地的 20:00。送一個沒有時區的字串
 * 上去，是由伺服器那台機器的時區去解讀它 —— 那台跑在 UTC，於是台灣時間整整差八小時。
 */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function toIso(local) {
  return local ? new Date(local).toISOString() : null
}

/** 在列表上看時間。到分鐘為止 —— 秒數對一張折扣碼從來不是問題。 */
function shortStamp(iso) {
  return iso ? toLocalInput(iso).replace('T', ' ') : '—'
}

/** 多選的一格：再按一次就取消，全部取消就是不限。 */
function toggle(list, key) {
  return list.includes(key) ? list.filter(x => x !== key) : [...list, key]
}

// 空白的一張。max_uses_per_player 預設 1 —— 「一人一次」是絕大多數情況，忘了填時
// 該落在嚴格那一邊。
function blank() {
  return {
    code: '', kind: 'percent', value: '', startsAt: '', endsAt: '',
    maxUses: '', maxUsesPerPlayer: 1, tierKeys: [], periodKeys: [],
    minAmount: '', publicLabel: '', note: '', active: true, isNew: true
  }
}

function edit(c) {
  editing.value = c ? {
    code: c.code,
    kind: c.kind,
    value: String(c.value),
    startsAt: toLocalInput(c.starts_at),
    endsAt: toLocalInput(c.ends_at),
    maxUses: c.max_uses ?? '',
    maxUsesPerPlayer: c.max_uses_per_player,
    tierKeys: [...(c.tier_keys || [])],
    periodKeys: [...(c.period_keys || [])],
    minAmount: c.min_amount ?? '',
    publicLabel: c.public_label || '',
    note: c.note || '',
    active: c.active,
    isNew: false
  } : blank()
}

const save = () => run(async () => {
  const e = editing.value
  await saveHandbookCoupon(adminToken.value, e.code.trim().toUpperCase(), {
    kind: e.kind,
    value: Number(e.value),
    startsAt: toIso(e.startsAt),
    endsAt: toIso(e.endsAt),
    maxUses: e.maxUses === '' ? null : Number(e.maxUses),
    maxUsesPerPlayer: Number(e.maxUsesPerPlayer) || 1,
    tierKeys: e.tierKeys,
    periodKeys: e.periodKeys,
    minAmount: e.minAmount === '' ? null : Number(e.minAmount),
    publicLabel: e.publicLabel,
    note: e.note,
    active: e.active
  })
  editing.value = null
  await load()
})

const remove = c => run(async () => {
  await deleteHandbookCoupon(adminToken.value, c.code)
  await load()
})

const showUses = c => run(async () => {
  couponUses.value = { ...couponUses.value, [c.code]: (await listHandbookCouponUses(adminToken.value, c.code)).uses }
})

/** 人看得懂的折扣。 */
function couponOff(c) {
  return c.kind === 'percent' ? `-${Number(c.value)}%` : `-NT$ ${Number(c.value)}`
}

function money(n) {
  return `NT$ ${Number(n || 0).toLocaleString('en-US')}`
}
function shortDate(iso) {
  return iso ? String(iso).slice(0, 10) : '—'
}
</script>

<template>
  <div class="board select-board ac-board">
    <!-- 列表與編輯是兩個畫面。表單接在列表後面的話，按下「編輯」之後要操作的欄位在整串
         折扣碼的下方，每改一格都得先捲過一遍列表，也看不出自己正在編的是哪一張。 -->
    <div class="ac-title modal-title">
      {{ editing ? (editing.isNew ? t('admin.couponNew') : editing.code) : t('admin.couponsTitle') }}
    </div>

    <div v-if="editing" class="ac-scroll">
      <p v-if="error" class="ac-error">{{ error }}</p>
      <label class="ac-f">
        <span>{{ t('admin.couponCode') }}</span>
        <input v-model="editing.code" class="ac-in" :disabled="!editing.isNew" placeholder="WELCOME15">
      </label>
      <label class="ac-f">
        <span>{{ t('admin.couponKind') }}</span>
        <select v-model="editing.kind" class="ac-in">
          <option value="percent">{{ t('admin.couponPercent') }}</option>
          <option value="amount">{{ t('admin.couponAmount') }}</option>
        </select>
      </label>
      <label class="ac-f">
        <span>{{ editing.kind === 'percent' ? t('admin.couponValuePct') : t('admin.couponValueAmt') }}</span>
        <input v-model="editing.value" class="ac-in" type="number" min="1">
      </label>
      <!-- 到分鐘。一張碼常常是配著一則公告開的（「晚上八點開賣」），只能填到日的話，
           那張碼不是早八小時就生效、就是得有人守在旁邊手動開。 -->
      <label class="ac-f">
        <span>{{ t('admin.couponFrom') }}</span>
        <input v-model="editing.startsAt" class="ac-in" type="datetime-local">
      </label>
      <label class="ac-f">
        <span>{{ t('admin.couponTo') }}</span>
        <input v-model="editing.endsAt" class="ac-in" type="datetime-local">
      </label>
      <!-- 空白 = 不限制。placeholder 每一格都講一次，不然填的人會以為空白是還沒填完。 -->
      <label class="ac-f">
        <span>{{ t('admin.couponMaxUses') }}</span>
        <input v-model="editing.maxUses" class="ac-in" type="number" min="1" :placeholder="t('admin.couponNoLimit')">
      </label>
      <label class="ac-f">
        <span>{{ t('admin.couponPerPlayerField') }}</span>
        <input v-model="editing.maxUsesPerPlayer" class="ac-in" type="number" min="1">
      </label>
      <!-- 從現有的方案與繳費週期上挑，不是自己打代號：打錯一個字的下場是一張「限定一個
           不存在的方案」的碼，而它看起來跟設定正確的碼一模一樣，直到有人回報折扣碼沒用。
           一個都沒選 = 不限，所以「不限」本身也是一格，不用靠空白去表達。 -->
      <div class="ac-f top">
        <span>{{ t('admin.couponTiers') }}</span>
        <div class="ac-chips">
          <button
            :class="['ac-chip', { on: !editing.tierKeys.length }]"
            @click="editing.tierKeys = []"
          >{{ t('admin.couponAny') }}</button>
          <button
            v-for="o in tierOptions"
            :key="o.key"
            :class="['ac-chip', { on: editing.tierKeys.includes(o.key) }]"
            @click="editing.tierKeys = toggle(editing.tierKeys, o.key)"
          >{{ (o.name || o.key).split('｜')[0] }}</button>
        </div>
      </div>
      <div class="ac-f top">
        <span>{{ t('admin.couponPeriods') }}</span>
        <div class="ac-chips">
          <button
            :class="['ac-chip', { on: !editing.periodKeys.length }]"
            @click="editing.periodKeys = []"
          >{{ t('admin.couponAny') }}</button>
          <button
            v-for="o in periodOptions"
            :key="o.key"
            :class="['ac-chip', { on: editing.periodKeys.includes(o.key) }]"
            @click="editing.periodKeys = toggle(editing.periodKeys, o.key)"
          >{{ t(`handbook.period.${o.key}`) }}</button>
        </div>
      </div>
      <label class="ac-f">
        <span>{{ t('admin.couponMin') }}</span>
        <input v-model="editing.minAmount" class="ac-in" type="number" min="0" :placeholder="t('admin.couponNoLimit')">
      </label>
      <!-- 上面那行玩家在結帳頁套用成功後看得到，下面那行只有這個畫面看得到。 -->
      <label class="ac-f">
        <span>{{ t('admin.couponLabel') }}</span>
        <input v-model="editing.publicLabel" class="ac-in">
      </label>
      <label class="ac-f">
        <span>{{ t('admin.couponNote') }}</span>
        <input v-model="editing.note" class="ac-in" :placeholder="t('admin.couponNotePh')">
      </label>
      <label class="ac-f">
        <span>{{ t('admin.couponActive') }}</span>
        <input v-model="editing.active" type="checkbox">
      </label>
    </div>

    <div v-else class="ac-scroll">
      <p v-if="error" class="ac-error">{{ error }}</p>

      <div class="ac-bar">
        <button class="ac-btn" @click="edit(null)">{{ t('admin.couponNew') }}</button>
        <button class="ac-btn ghost" @click="load">{{ t('admin.salesReload') }}</button>
      </div>

      <div v-for="c in coupons" :key="c.code" class="ac-item">
        <div class="ac-top">
          <span class="ac-pill" :class="c.active ? 'paid' : 'failed'">{{ couponOff(c) }}</span>
          <span class="ac-code">{{ c.code }}</span>
          <span class="ac-grow"></span>
          <span class="ac-amt">{{ c.paidUses }}<template v-if="c.max_uses"> / {{ c.max_uses }}</template></span>
        </div>
        <div class="ac-sub">
          {{ t('admin.couponPerPlayer', { n: c.max_uses_per_player }) }}
          <template v-if="c.starts_at || c.ends_at">
            · {{ shortStamp(c.starts_at) }} ~ {{ shortStamp(c.ends_at) }}
          </template>
          <template v-if="c.tier_keys"> · {{ c.tier_keys.join('/') }}</template>
          <template v-if="c.period_keys"> · {{ c.period_keys.join('/') }}</template>
          <template v-if="c.min_amount"> · ≥ {{ money(c.min_amount) }}</template>
          <!-- 占住但還沒付款的。限量碼被幾個半途離開付款頁的人吃掉時，只有這個數字看得出來。 -->
          <span v-if="c.heldUses > c.paidUses" class="ac-held">
            {{ t('admin.couponHeld', { n: c.heldUses - c.paidUses }) }}
          </span>
        </div>
        <!-- 👁 的那一行玩家看得到（跟手冊後台的 👁 同一個意思），另一行只有這裡看得到。 -->
        <div v-if="c.public_label" class="ac-why">👁 {{ c.public_label }}</div>
        <div v-if="c.note" class="ac-sub">{{ c.note }}</div>
        <div class="ac-sub">{{ t('admin.couponGiven', { n: money(c.given) }) }}</div>

        <div class="ac-act">
          <button class="ac-btn ghost" @click="edit(c)">{{ t('admin.couponEdit') }}</button>
          <button class="ac-btn ghost" @click="showUses(c)">{{ t('admin.couponWhoUsed') }}</button>
          <!-- 用過的不給刪：刪掉它，那幾筆訂單上的折抵就變成一個指不到任何東西的代號。 -->
          <button v-if="!c.paidUses && !c.heldUses" class="ac-btn ghost" @click="remove(c)">
            {{ t('admin.couponDelete') }}
          </button>
        </div>

        <div v-if="couponUses[c.code]" class="ac-uses">
          <p v-if="!couponUses[c.code].length" class="ac-none">{{ t('admin.couponNoUses') }}</p>
          <div v-for="u in couponUses[c.code]" :key="u.merchantTradeNo" class="ac-use">
            <span class="ac-code">{{ u.playerCode }}</span>
            <span class="ac-name">{{ u.playerName }}</span>
            <span class="ac-grow"></span>
            <span>−{{ money(u.discount) }}</span>
            <span class="ac-pill" :class="u.refundedAt ? 'refunded' : u.status">{{ u.refundedAt ? 'refunded' : u.status }}</span>
            <span class="ac-at">{{ shortDate(u.at) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 送出的那顆鍵釘在底部，表單再長都在同一個位置。 -->
    <div class="ac-foot">
      <template v-if="editing">
        <button class="ac-btn" :disabled="busy || !editing.code.trim() || !editing.value" @click="save">
          {{ t('common.save') }}
        </button>
        <button class="ac-btn ghost" @click="editing = null">{{ t('common.cancel') }}</button>
      </template>
      <button v-else class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.ac-board { display: flex; flex-direction: column; min-height: 0; }
.ac-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.125rem; }
.ac-foot { display: flex; gap: 0.5rem; padding-top: 0.75rem; }
.ac-error { margin: 0 0 0.375rem; font-size: 0.625rem; font-weight: 800; color: #C0392B; }
.ac-none { margin: 0 0 0.375rem; font-size: 0.5625rem; font-weight: 600; color: var(--sub); }

.ac-bar { display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.375rem; }
.ac-btn {
  padding: 0.1875rem 0.5rem; font-size: 0.625rem; font-weight: 800;
  border: 0.0625rem solid var(--ink); border-radius: 0.25rem;
  background: var(--ink); color: #fff; cursor: pointer;
}
.ac-btn:disabled { opacity: 0.35; cursor: default; }
.ac-btn.ghost { background: #fff; color: var(--ink); }

.ac-item {
  padding: 0.3125rem; margin-bottom: 0.25rem;
  border: 0.0625rem solid var(--line); border-radius: 0.375rem; background: var(--card);
}
.ac-top { display: flex; align-items: baseline; gap: 0.3125rem; font-size: 0.625rem; font-weight: 700; }
.ac-sub { margin-top: 0.125rem; font-size: 0.5625rem; font-weight: 600; color: var(--sub); }
.ac-act { display: flex; gap: 0.25rem; margin-top: 0.25rem; }
.ac-why { margin-top: 0.125rem; font-size: 0.5625rem; font-weight: 700; color: #B9770E; line-height: 1.5; }
.ac-grow { flex: 1; }
.ac-code { font-variant-numeric: tabular-nums; color: var(--sub); }
.ac-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-amt { font-variant-numeric: tabular-nums; font-weight: 800; }
.ac-at { font-size: 0.5rem; color: var(--sub); font-variant-numeric: tabular-nums; }
.ac-pill {
  flex: none; padding: 0 0.25rem; border-radius: 0.1875rem;
  font-size: 0.5rem; font-weight: 800; text-transform: uppercase; color: #fff; background: var(--sub);
}
.ac-pill.paid { background: #1E8449; }
.ac-pill.failed { background: #C0392B; }
.ac-pill.pending { background: #B9770E; }
.ac-pill.refunded { background: #6C3483; }
.ac-held {
  margin-left: 0.25rem; padding: 0 0.1875rem; border-radius: 0.1875rem;
  background: #B9770E; color: #fff; font-size: 0.5rem; font-weight: 800;
}

.ac-uses { margin-top: 0.5rem; border-top: 1px dashed var(--line); padding-top: 0.375rem; }
.ac-use {
  display: flex; align-items: center; gap: 0.375rem;
  padding: 0.1875rem 0; font-size: 0.6875rem; font-variant-numeric: tabular-nums;
}

.ac-f { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.375rem; font-size: 0.6875rem; }
.ac-f.top { align-items: flex-start; }
.ac-chips { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.ac-chip {
  padding: 0.25rem 0.5rem;
  border: 0.0625rem solid var(--line); border-radius: 999px;
  background: #fff; color: var(--sub);
  font: inherit; font-size: 0.6875rem; font-weight: 700; cursor: pointer;
}
.ac-chip.on { background: var(--ink); border-color: var(--ink); color: #fff; }
.ac-f > span { flex: none; width: 7rem; color: var(--sub); }
.ac-in {
  flex: 1; min-width: 0;
  padding: 0.3125rem 0.4375rem;
  border: 0.0625rem solid var(--line); border-radius: 0.25rem;
  background: #fff; color: var(--ink);
  font: inherit; font-size: 0.75rem; font-weight: 700;
}
.ac-in:disabled { background: rgba(0, 0, 0, 0.05); color: var(--sub); }
</style>

