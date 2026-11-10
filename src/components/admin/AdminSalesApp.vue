<script setup>
// 手冊的錢。四個分頁，順序是刻意的 —— 最上面那個不是報表，是待辦。
//
// 到期  單筆繳清沒有自動續約，所以每個訂閱者都會在某天安靜地過期，而且沒有任何東西
//       會告訴你。這一頁就是那個「告訴你」。放第一個，因為它是唯一需要你採取行動的。
// 訂單  誰付了什麼、哪些失敗了、為什麼。「我付了錢但沒開通」只能在這裡回答。
// 收入  每月毛收入、退款、淨額，以及各方案現在有幾個人。
// 對帳  跟綠界的對帳檔兩邊比。抓的是「有人付了錢而我們不知道」。
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { adminToken } from '../../data/adminSession'
import {
  getHandbookRevenue, listHandbookOrders, listHandbookSubscriptions, reconcileHandbook,
  refundHandbookOrder
} from '../../data/adminApi'

const emit = defineEmits(['back'])
const { t } = useI18n()

const tab = ref('expiring')
const busy = ref(false)
const error = ref('')

const expiring = ref([])
const forever = ref([])
const within = ref(14)
const orders = ref([])
const orderFilter = ref('')
const revenue = ref(null)
const recon = ref(null)
const reconBegin = ref(isoDaysAgo(7))
const reconEnd = ref(isoDaysAgo(1))

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

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

const loadExpiring = () => run(async () => {
  const d = await listHandbookSubscriptions(adminToken.value, within.value, 30)
  expiring.value = d.expiring
  forever.value = d.forever
})
const loadOrders = () => run(async () => {
  orders.value = (await listHandbookOrders(adminToken.value, orderFilter.value)).orders
})
const loadRevenue = () => run(async () => { revenue.value = await getHandbookRevenue(adminToken.value) })
const loadRecon = () => run(async () => {
  recon.value = await reconcileHandbook(adminToken.value, reconBegin.value, reconEnd.value)
})

function openTab(key) {
  tab.value = key
  if (key === 'expiring' && !expiring.value.length) loadExpiring()
  if (key === 'orders' && !orders.value.length) loadOrders()
  if (key === 'revenue' && !revenue.value) loadRevenue()
}

onMounted(loadExpiring)

// 已經過期的排在最前面（days 是負的），接著是快到的。那正是該聯絡的順序。
const expiringSorted = computed(() => [...expiring.value].sort((a, b) => a.days - b.days))

/**
 * 把名單複製成一串代號，貼到社團公告或私訊用。
 *
 * 這一頁真正要產出的東西就是這個 —— 看完名單還要一個一個手抄代號的話，提醒這件事
 * 就會變成「下次再說」。
 */
async function copyCodes() {
  const text = expiringSorted.value.map(r => r.code).join(' ')
  try {
    await navigator.clipboard.writeText(text)
    error.value = t('admin.salesCopied', { n: expiringSorted.value.length })
  } catch {
    error.value = text
  }
}

const refunding = ref(null)
const refundNote = ref('')
const refundAmount = ref('')
const refundRevoke = ref('keep')

function startRefund(o) {
  refunding.value = o
  refundNote.value = ''
  refundAmount.value = String(o.amount)
  refundRevoke.value = 'keep'
}

const doRefund = () => run(async () => {
  await refundHandbookOrder(adminToken.value, refunding.value.merchantTradeNo, {
    amount: Number(refundAmount.value),
    note: refundNote.value,
    revoke: refundRevoke.value
  })
  refunding.value = null
  orders.value = (await listHandbookOrders(adminToken.value, orderFilter.value)).orders
  revenue.value = null
})

function money(n) {
  return `NT$ ${Number(n || 0).toLocaleString('en-US')}`
}
function shortDate(iso) {
  return iso ? String(iso).slice(0, 10) : '—'
}
</script>

<template>
  <div class="board select-board as-board">
    <div class="modal-title">{{ t('admin.salesTitle') }}</div>

    <div class="as-tabs">
      <button
        v-for="k in ['expiring', 'orders', 'revenue', 'recon']"
        :key="k"
        class="as-tab"
        :class="{ on: tab === k }"
        @click="openTab(k)"
      >{{ t(`admin.salesTab.${k}`) }}</button>
    </div>

    <div class="as-scroll">
      <p v-if="error" class="as-error">{{ error }}</p>
      <p v-if="busy" class="as-note">{{ t('handbook.loading') }}</p>

      <!-- ① 到期名單 ------------------------------------------------------- -->
      <template v-if="tab === 'expiring'">
        <p class="as-note">{{ t('admin.salesExpiringHint') }}</p>
        <div class="as-bar">
          <label class="as-note">{{ t('admin.salesWithin') }}</label>
          <select v-model.number="within" class="as-in" @change="loadExpiring">
            <option :value="7">7</option>
            <option :value="14">14</option>
            <option :value="30">30</option>
            <option :value="60">60</option>
          </select>
          <button class="as-btn" :disabled="!expiringSorted.length" @click="copyCodes">
            {{ t('admin.salesCopyCodes') }}
          </button>
        </div>

        <p v-if="!busy && !expiringSorted.length" class="as-note">{{ t('admin.salesNoExpiring') }}</p>
        <div v-for="r in expiringSorted" :key="r.code" class="as-row" :class="{ gone: r.days < 0 }">
          <span class="as-code">{{ r.code }}</span>
          <span class="as-name">{{ r.name }}</span>
          <span class="as-tier">{{ r.tierKey }}</span>
          <span class="as-num">{{ r.expiresOn }}</span>
          <!-- 負數 = 已經過期幾天。那些人最值得找回來，而且多半只是忘了。 -->
          <span class="as-days" :class="{ gone: r.days < 0 }">
            {{ r.days < 0 ? t('admin.salesGoneDays', { n: -r.days }) : t('admin.salesLeftDays', { n: r.days }) }}
          </span>
        </div>

        <template v-if="forever.length">
          <h3 class="as-label">{{ t('admin.salesForever') }}</h3>
          <div v-for="r in forever" :key="r.code" class="as-row">
            <span class="as-code">{{ r.code }}</span>
            <span class="as-name">{{ r.name }}</span>
            <span class="as-tier">{{ r.tierKey }}</span>
            <span class="as-num">∞</span>
          </div>
        </template>
      </template>

      <!-- ② 訂單 ----------------------------------------------------------- -->
      <template v-else-if="tab === 'orders'">
        <div class="as-bar">
          <select v-model="orderFilter" class="as-in" @change="loadOrders">
            <option value="">{{ t('admin.salesAll') }}</option>
            <option value="paid">paid</option>
            <option value="failed">failed</option>
            <option value="pending">pending</option>
            <option value="refunded">refunded</option>
          </select>
          <button class="as-btn" @click="loadOrders">{{ t('admin.salesReload') }}</button>
        </div>

        <div v-for="o in orders" :key="o.merchantTradeNo" class="as-order">
          <div class="as-order-top">
            <span class="as-pill" :class="o.status">{{ o.status }}</span>
            <span class="as-code">{{ o.code }}</span>
            <span class="as-name">{{ o.playerName }}</span>
            <span class="as-grow"></span>
            <span class="as-amt">{{ money(o.amount) }}</span>
          </div>
          <div class="as-order-sub">
            {{ o.tierKey }} · {{ o.months }}m · {{ shortDate(o.createdAt) }}
            <template v-if="o.grantedUntil"> · → {{ o.grantedUntil }}</template>
            <span v-if="o.simulatePaid" class="as-sim">SIM</span>
            <!-- 折扣碼跟著訂單走。對帳時「為什麼只收了 334」在這裡就回答得了。 -->
            <span v-if="o.couponCode" class="as-cp">{{ o.couponCode }} −{{ money(o.discount) }}</span>
          </div>
          <!-- 失敗原因原樣顯示：「金額不符」跟「卡片被拒」要做的事完全不同。 -->
          <div v-if="o.rtnMsg && o.status !== 'paid'" class="as-why">{{ o.rtnMsg }}</div>
          <div v-if="o.status === 'refunded'" class="as-why">
            {{ t('admin.salesRefunded', { n: money(o.refundedAmount), at: shortDate(o.refundedAt) }) }}
            <template v-if="o.refundNote"> · {{ o.refundNote }}</template>
          </div>
          <div v-if="o.status === 'paid'" class="as-order-act">
            <button class="as-btn ghost" @click="startRefund(o)">{{ t('admin.salesMarkRefunded') }}</button>
          </div>
          <div class="as-no">{{ o.merchantTradeNo }}</div>
        </div>
      </template>

      <!-- ③ 收入 ----------------------------------------------------------- -->
      <template v-else-if="tab === 'revenue'">
        <template v-if="revenue">
          <h3 class="as-label">{{ t('admin.salesByMonth') }}</h3>
          <div v-for="m in revenue.months" :key="m.month" class="as-row">
            <span class="as-code">{{ m.month }}</span>
            <span class="as-name">{{ t('admin.salesNOrders', { n: m.orders }) }}</span>
            <span class="as-grow"></span>
            <span v-if="m.refunded" class="as-neg">−{{ money(m.refunded) }}</span>
            <span class="as-amt">{{ money(m.gross - m.refunded) }}</span>
          </div>

          <h3 class="as-label">{{ t('admin.salesByTier') }}</h3>
          <div v-for="x in revenue.byTier" :key="x.tierKey" class="as-row">
            <span class="as-name grow">{{ (x.name || x.tierKey).split('｜')[0] }}</span>
            <span class="as-amt">{{ x.active }}</span>
          </div>

          <h3 class="as-label">{{ t('admin.salesFunnel') }}</h3>
          <!-- pending 永遠不會是零：消費者在綠界頁面按返回不會有任何通知，那筆就一直
               停在這裡。有用的是比例，不是數字本身。 -->
          <p class="as-note">{{ t('admin.salesFunnelHint') }}</p>
          <div class="as-row">
            <span class="as-name grow">paid {{ revenue.funnel.paid }} · failed {{ revenue.funnel.failed }} · pending {{ revenue.funnel.pending }}</span>
          </div>
        </template>
      </template>

      <!-- ④ 對帳 ----------------------------------------------------------- -->
      <template v-else>
        <p class="as-note">{{ t('admin.salesReconHint') }}</p>
        <div class="as-bar">
          <input v-model="reconBegin" class="as-in date" type="date">
          <input v-model="reconEnd" class="as-in date" type="date">
          <button class="as-btn" @click="loadRecon">{{ t('admin.salesRun') }}</button>
        </div>

        <template v-if="recon">
          <p v-if="recon.sharedTestAccount" class="as-warn">{{ t('admin.salesSharedAccount') }}</p>
          <div class="as-row">
            <span class="as-name grow">{{ t('admin.salesCounts', { a: recon.ecpayCount, b: recon.ourCount }) }}</span>
          </div>

          <!-- 這一項是對帳真正要抓的東西：我們記成已付，但綠界沒有這筆。代表那通知
               不是綠界送的，或金鑰換過之後有舊單對不上。 -->
          <h3 class="as-label">{{ t('admin.salesOnlyOurs') }}（{{ recon.onlyOurs.length }}）</h3>
          <div v-for="o in recon.onlyOurs" :key="o.no" class="as-row bad">
            <span class="as-code">{{ o.no }}</span>
            <span class="as-name">{{ o.code }}</span>
            <span class="as-grow"></span>
            <span class="as-amt">{{ money(o.amount) }}</span>
          </div>

          <h3 class="as-label">{{ t('admin.salesAmountDiff') }}（{{ recon.amountDiff.length }}）</h3>
          <div v-for="o in recon.amountDiff" :key="o.no" class="as-row bad">
            <span class="as-code">{{ o.no }}</span>
            <span class="as-grow"></span>
            <span class="as-amt">{{ money(o.ours) }} ≠ {{ money(o.amount) }}</span>
          </div>

          <h3 class="as-label">{{ t('admin.salesOnlyEcpay') }}（{{ recon.onlyEcpay.length }}）</h3>
          <div v-for="o in recon.onlyEcpay.slice(0, 50)" :key="o.no" class="as-row">
            <span class="as-code">{{ o.no }}</span>
            <span class="as-grow"></span>
            <span class="as-amt">{{ money(o.amount) }}</span>
          </div>
        </template>
      </template>
    </div>

    <div class="as-foot">
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>

    <!-- 退款確認 ----------------------------------------------------------- -->
    <div v-if="refunding" class="as-modal" @click.self="refunding = null">
      <div class="as-dialog">
        <h3 class="as-label">{{ t('admin.salesMarkRefunded') }}</h3>
        <!-- 最重要的一句話：這裡不退錢。 -->
        <p class="as-warn">{{ t('admin.salesRefundWarn') }}</p>
        <div class="as-bar">
          <span class="as-note">{{ t('admin.salesRefundAmount') }}</span>
          <input v-model="refundAmount" class="as-in num" type="number" min="1" :max="refunding.amount">
          <span class="as-note">/ {{ refunding.amount }}</span>
        </div>
        <select v-model="refundRevoke" class="as-in wide">
          <option value="keep">{{ t('admin.salesRevokeKeep') }}</option>
          <option value="cut">{{ t('admin.salesRevokeCut') }}</option>
          <option value="clear">{{ t('admin.salesRevokeClear') }}</option>
        </select>
        <input v-model="refundNote" class="as-in wide" :placeholder="t('admin.salesRefundNote')">
        <div class="as-bar end">
          <button class="as-btn ghost" @click="refunding = null">{{ t('common.back') }}</button>
          <button class="as-btn" @click="doRefund">{{ t('admin.salesConfirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.as-board { display: flex; flex-direction: column; min-height: 0; }
.as-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.125rem; }

.as-tabs { display: flex; gap: 0.1875rem; margin-bottom: 0.375rem; }
.as-tab {
  flex: 1; padding: 0.25rem 0.125rem; font-size: 0.625rem; font-weight: 800;
  border: 0.0625rem solid var(--line); border-radius: 0.25rem;
  background: #fff; color: var(--sub); cursor: pointer;
}
.as-tab.on { background: var(--ink); color: #fff; border-color: var(--ink); }

.as-cp {
  margin-left: 0.375rem;
  padding: 0.0625rem 0.375rem;
  border-radius: 999px;
  background: rgba(168, 87, 31, 0.14);
  color: #A8571F;
  font-size: 0.5625rem;
  font-weight: 800;
}
.as-uses { margin-top: 0.5rem; border-top: 1px dashed var(--line); padding-top: 0.375rem; }
.as-use {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.1875rem 0;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}
.as-edit {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.03);
}
.as-edit-h { margin: 0 0 0.5rem; font-size: 0.8125rem; font-weight: 800; }
.as-f {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
  font-size: 0.6875rem;
}
.as-f > span { flex: none; width: 7rem; color: var(--sub); }
.as-f .as-in { flex: 1; min-width: 0; }

.as-label {
  margin: 0.75rem 0 0.25rem; font-size: 0.6875rem; font-weight: 800; letter-spacing: 0.08em;
  color: var(--sub); border-bottom: 0.125rem solid var(--line); padding-bottom: 0.1875rem;
}
.as-note { margin: 0 0 0.375rem; font-size: 0.5625rem; font-weight: 600; color: var(--sub); line-height: 1.5; }
.as-error { margin: 0 0 0.375rem; font-size: 0.625rem; font-weight: 800; color: #C0392B; }
.as-warn {
  margin: 0 0 0.375rem; padding: 0.25rem 0.375rem; border-radius: 0.25rem;
  background: rgba(185, 119, 14, 0.12); font-size: 0.5625rem; font-weight: 700;
  color: #B9770E; line-height: 1.5;
}

.as-bar { display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.375rem; }
.as-bar.end { justify-content: flex-end; margin-top: 0.5rem; }
.as-in {
  min-width: 0; font-size: 0.625rem; font-weight: 700; color: var(--ink);
  padding: 0.1875rem 0.25rem; border: 0.0625rem solid var(--line); border-radius: 0.25rem;
  background: #fff;
}
.as-in.num { width: 4rem; }
.as-in.date { width: 7.5rem; }
.as-in.wide { width: 100%; margin-bottom: 0.25rem; }
.as-btn {
  padding: 0.1875rem 0.5rem; font-size: 0.625rem; font-weight: 800;
  border: 0.0625rem solid var(--ink); border-radius: 0.25rem;
  background: var(--ink); color: #fff; cursor: pointer;
}
.as-btn:disabled { opacity: 0.35; cursor: default; }
.as-btn.ghost { background: #fff; color: var(--ink); }

.as-row {
  display: flex; align-items: baseline; gap: 0.375rem;
  padding: 0.25rem 0.375rem; border-bottom: 0.0625rem solid var(--line);
  font-size: 0.625rem; font-weight: 700;
}
.as-row.gone { background: rgba(192, 57, 43, 0.06); }
.as-row.bad { background: rgba(192, 57, 43, 0.1); }
.as-code { font-variant-numeric: tabular-nums; color: var(--sub); }
.as-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.as-name.grow { flex: 1; }
.as-tier { font-size: 0.5625rem; color: var(--sub); }
.as-num { font-variant-numeric: tabular-nums; color: var(--sub); }
.as-grow { flex: 1; }
.as-amt { font-variant-numeric: tabular-nums; font-weight: 800; }
.as-neg { font-variant-numeric: tabular-nums; color: #C0392B; font-size: 0.5625rem; }
.as-days { font-size: 0.5625rem; font-weight: 800; color: var(--sub); }
.as-days.gone { color: #C0392B; }

.as-order {
  padding: 0.3125rem; margin-bottom: 0.25rem;
  border: 0.0625rem solid var(--line); border-radius: 0.375rem; background: var(--card);
}
.as-order-top { display: flex; align-items: baseline; gap: 0.3125rem; font-size: 0.625rem; font-weight: 700; }
.as-order-sub { margin-top: 0.125rem; font-size: 0.5625rem; font-weight: 600; color: var(--sub); }
.as-order-act { margin-top: 0.25rem; }
.as-why { margin-top: 0.125rem; font-size: 0.5625rem; font-weight: 700; color: #B9770E; line-height: 1.5; }
.as-no { margin-top: 0.125rem; font-size: 0.5rem; color: var(--sub); font-variant-numeric: tabular-nums; }
.as-pill {
  flex: none; padding: 0 0.25rem; border-radius: 0.1875rem;
  font-size: 0.5rem; font-weight: 800; text-transform: uppercase; color: #fff; background: var(--sub);
}
.as-pill.paid { background: #1E8449; }
.as-pill.failed { background: #C0392B; }
.as-pill.pending { background: #B9770E; }
.as-pill.refunded { background: #6C3483; }
.as-sim {
  margin-left: 0.25rem; padding: 0 0.1875rem; border-radius: 0.1875rem;
  background: #B9770E; color: #fff; font-size: 0.5rem; font-weight: 800;
}

.as-foot { display: flex; justify-content: flex-end; gap: 0.375rem; padding-top: 0.375rem; }

.as-modal {
  position: fixed; inset: 0; z-index: 9700;
  background: rgba(20, 16, 10, 0.6);
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.as-dialog {
  width: 100%; max-width: 20rem; padding: 0.75rem;
  border-radius: 0.5rem; background: var(--card);
}
</style>
