<script setup>
// 結帳：確認 → 導向綠界 → 回來看結果。
//
// 三個階段放在同一個元件裡，是因為它們講的是同一筆訂單 —— 拆成三頁的話，失敗後要回到
// 哪裡就會變成一個得另外回答的問題。
//
// 付款真正的憑證是綠界打回後端的 ReturnURL，不是這個畫面。使用者瀏覽器被導回來時，
// 那通知可能都還沒到，所以「成功」永遠是向後端查出來的結果，不是網址上的參數 ——
// 那是可以偽造的，而且時序上也不保證。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ladderIsLive, metaOf, myExpiresOn, rankOf, tierFor } from '../../data/handbookTiers'
import { createCheckout, getOrder, inAppBrowser, quoteCheckout, submitToGateway } from '../../data/handbookApi'
import { getToken } from '../../data/session'

const props = defineProps({
  // 從方案頁按進來時有；從綠界導回來時沒有（那時只有單號）。
  tier: { type: Object, default: null },
  period: { type: Object, default: null },
  units: { type: Array, default: () => [] },
  // 有值就表示這是從綠界回來的，直接進查詢狀態。
  orderNo: { type: String, default: '' }
})
const emit = defineEmits(['close', 'done', 'signIn'])
const { t } = useI18n()

// 一筆訂單屬於一個帳號，兩邊的身分都是同一份憑證認出來的 —— 開單要它，回來查狀態也要它。
// 方案頁已經把訪客攔在結帳之前，這裡是同一條規則在它真正生效的地方再寫一次。
const signedIn = () => !!getToken()

// idle → paying → checking → paid | failed；signin 是沒有身分時的岔路
const state = ref(props.orderNo ? (signedIn() ? 'checking' : 'signin') : 'idle')
const failure = ref('')
const order = ref(null)

// 這一檔實際解鎖幾章 —— 不是整本書。傳進來的 units 是全書，拿 units.length 當分子會讓
// 訂單頁對每一檔都寫「全部解鎖」，而那是在收錢的畫面上說假話。
const mine = computed(() => {
  if (!props.tier) return []
  const want = rankOf(props.tier.key)
  return props.units.filter(u => {
    const need = rankOf(tierFor(u))
    return need >= 0 && need <= want
  })
})

const monthly = computed(() => Number(props.tier?.usd) || 0)
// 牌價。折扣碼套用之後，要收的是 `amount`，但這個數字還是要留著 —— 看得到折扣從哪裡
// 折下來，折扣才有意義。
const listed = computed(() =>
  props.period ? monthly.value * (props.period.months - props.period.free) : 0
)

/* ── 折扣碼 ───────────────────────────────────────────────────────────────
   金額一律由伺服器算。這裡送出去的永遠只有「哪一檔、買多久、碼是什麼」，拿回來的
   數字只拿來顯示 —— 真正會被刷的金額是結帳那一刻伺服器重算的那個。
*/
const code = ref('')
const codeError = ref('')
const checkingCode = ref(false)

/**
 * 伺服器算出來的這一單：折多少、收多少、權限到哪一天。
 *
 * 一進這個畫面就先問一次（不帶折扣碼），套用折扣碼時再問一次。沒拿到之前畫面用前端
 * 自己算的當暫代值，拿到之後一律以它為準 —— 升級會把舊方案剩下的天數按比例折算，那段
 * 算式只在伺服器上，前端自己加月份會在收錢的畫面寫一個他拿不到的日期。
 */
const quote = ref(null)
const applied = computed(() => (quote.value?.code ? quote.value : null))

const discount = computed(() => quote.value?.discount || 0)
const amount = computed(() => (quote.value ? quote.value.amount : listed.value))

// 伺服器回的是穩定的英文字串，翻譯留在前端 —— 跟 LoginApp 同一種做法。
const CODE_ERRORS = {
  'coupon not found': 'couponNotFound',
  'coupon is not active': 'couponInactive',
  'coupon has not started': 'couponNotStarted',
  'coupon has expired': 'couponExpired',
  'coupon does not apply to this plan': 'couponWrongPlan',
  'coupon does not apply to this period': 'couponWrongPeriod',
  'order is below the coupon minimum': 'couponBelowMin',
  'coupon is fully used': 'couponUsedUp',
  'coupon already used': 'couponAlreadyUsed'
}

/** 向伺服器要一次試算。`want` 空字串＝不帶折扣碼。 */
async function refreshQuote(want = '') {
  if (!props.tier || !props.period) return
  checkingCode.value = true
  codeError.value = ''
  try {
    quote.value = await quoteCheckout(getToken(), props.tier.key, props.period.key, want)
    if (quote.value.code) code.value = quote.value.code
  } catch (err) {
    // 帶碼失敗就把碼的錯誤講出來，但原本那份（不帶碼的）試算要留著，不然日期與金額
    // 會整個掉回前端自己算的。
    if (want) codeError.value = t(`handbook.${CODE_ERRORS[err.message] || 'couponGeneric'}`)
  } finally {
    checkingCode.value = false
  }
}

function applyCode() {
  const want = code.value.trim()
  if (want && !checkingCode.value) refreshQuote(want)
}

function dropCode() {
  code.value = ''
  codeError.value = ''
  refreshQuote()
}
// 從方案頁進來時手上有整個 tier 物件；從綠界回來時只有訂單上的鍵值（'pro'），要自己
// 去階梯上把名字換回來 —— 收錢的畫面上不該出現資料庫裡的字。
const planName = computed(() => {
  const name = props.tier?.name || metaOf(order.value?.tierKey)?.name || ''
  return name.split('｜')[0] || order.value?.tierKey || ''
})

// 從現有到期日往後加，不是從今天 —— 提前續訂的人不該因為早付錢而少拿天數。
// 這只是畫面上的預估；真正的日期由後端用 Postgres 的 CURRENT_DATE 算，回來之後以它為準。
const startsFrom = computed(() => {
  const now = new Date()
  const cur = myExpiresOn.value ? new Date(myExpiresOn.value) : now
  return cur > now ? cur : now
})
const endsOn = computed(() => {
  // 已經付完款的那一筆，以訂單上的為準。
  if (order.value?.grantedUntil) return order.value.grantedUntil
  // 其次是伺服器的試算 —— 升級的折算只有它算得出來。
  if (quote.value?.grantsUntil) return quote.value.grantsUntil
  // 最後才是前端自己加月份的暫代值，只在試算還沒回來的那一瞬間會看到。
  if (!props.period) return ''
  const d = new Date(startsFrom.value)
  d.setMonth(d.getMonth() + props.period.months)
  return d.toISOString().slice(0, 10)
})
const extending = computed(() => myExpiresOn.value && new Date(myExpiresOn.value) > new Date())

// App 內嵌瀏覽器（LINE / FB / IG）會讓綠界付款頁整個打不開，而且沒有錯誤訊息。
// 從 FB 社團貼文點進來的人預設就在這種瀏覽器裡，所以先講。
const embedded = ref(null)
onMounted(() => {
  embedded.value = inAppBrowser()
  // 從綠界回來的那一趟沒有 tier/period，不試算。
  if (!props.orderNo) refreshQuote()
})

// 預設不打勾，而且沒勾就按不下去。
const agreed = ref(false)

/**
 * 按下付款。先去條款那一關。
 *
 * 消保法第 19 條給通訊交易七天的無條件解除權，而「通訊交易解除權合理例外情事適用準則」
 * 第 2 條第 5 款把「非以有形媒介提供之數位內容或一經提供即為完成之線上服務，經消費者
 * 事先同意始提供」排除在外。排除要成立有兩個前提，缺一不可：**事先告知**，以及**事先
 * 同意**。沒做到的話，七天解除權照樣存在 —— 那是法律的預設值，不是我們能用一行條款
 * 自己拿掉的東西。
 *
 * 所以這一關不是裝飾。它就是那兩個前提本身，必須落在錢離開之前，而且勾選框預設不打勾
 * ——「事先同意」要是人主動做的動作，不是我們替他做好的。
 */
function pay() {
  if (!signedIn()) return emit('signIn')
  agreed.value = false
  state.value = 'terms'
}

async function startPayment() {
  state.value = 'paying'
  failure.value = ''
  try {
    const res = await createCheckout(getToken(), props.tier.key, props.period.key, applied.value?.code || '')
    // 折扣碼把金額折到 0：沒有錢要收，就不會有綠界那一趟。伺服器已經開通了，直接跳完成頁。
    if (res.free) {
      order.value = { tierKey: props.tier.key, grantedUntil: res.grantedUntil, status: 'paid' }
      return (state.value = 'paid')
    }
    // 走到這裡就會離開這一頁了。回來時是一個全新的 App，帶著 ?ecpay=<單號>。
    submitToGateway(res)
  } catch (err) {
    failure.value = err.message
    state.value = 'failed'
  }
}

// 從綠界回來之後向後端問狀態。
//
// 要輪詢是因為兩條路會賽跑：使用者的瀏覽器被導回來，跟綠界的伺服器打 ReturnURL，
// 沒有先後保證。第一次查到 pending 很正常，不是失敗。
let timer = null
const POLL_MS = 1500
const GIVE_UP_AFTER = 20000

async function checkOrder(startedAt = Date.now()) {
  try {
    const { order: o } = await getOrder(getToken(), props.orderNo)
    order.value = o
    if (o.status === 'paid') return (state.value = 'paid')
    if (o.status === 'failed') {
      failure.value = o.rtnMsg || ''
      return (state.value = 'failed')
    }
  } catch (err) {
    failure.value = err.message
    return (state.value = 'failed')
  }
  // 還是 pending。等到放棄為止 —— 放棄不等於付款失敗，所以文案是「還在確認」而不是
  // 「失敗」：錢可能真的收了，只是通知還沒到。
  if (Date.now() - startedAt > GIVE_UP_AFTER) return (state.value = 'pending')
  timer = setTimeout(() => checkOrder(startedAt), POLL_MS)
}

onMounted(() => { if (state.value === 'checking') checkOrder() })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <div class="hc" @click.self="(state === 'idle' || state === 'signin') && emit('close')">
    <div class="hc-sheet">
      <template v-if="state === 'idle'">
        <button class="hc-x" :aria-label="t('common.back')" @click="emit('close')">✕</button>
        <h2 class="hc-title">{{ t('handbook.checkoutTitle') }}</h2>

        <dl class="hc-rows">
          <div>
            <dt>{{ t('handbook.coPlan') }}</dt>
            <dd>{{ planName }}</dd>
          </div>
          <div>
            <dt>{{ t('handbook.coPeriod') }}</dt>
            <dd>{{ t(`handbook.period.${period.key}`) }}</dd>
          </div>
          <!-- 同方案頁：權限設定讀不到時這一列整個不出現，不拿退路的數字充數。 -->
          <div v-if="ladderIsLive">
            <dt>{{ t('handbook.coUnlocks') }}</dt>
            <dd>{{ t('handbook.unlocksN', { n: mine.length, total: units.length }) }}</dd>
          </div>
          <div>
            <dt>{{ extending ? t('handbook.coExtendsTo') : t('handbook.coValidTo') }}</dt>
            <dd>{{ endsOn }}</dd>
          </div>
          <div v-if="discount" class="hc-cut">
            <dt>{{ t('handbook.couponDiscount') }}<span class="hc-codetag">{{ applied.code }}</span></dt>
            <dd>−NT$ {{ discount }}</dd>
          </div>
          <div class="hc-total">
            <dt>{{ t('handbook.coTotal') }}</dt>
            <dd>
              <span v-if="discount" class="hc-was">NT$ {{ listed }}</span>
              NT$ {{ amount }}
            </dd>
          </div>
        </dl>

        <!-- 折扣碼。套用是向伺服器問的，不是這裡算的 —— 畫面上的數字跟實際扣的款必須
             來自同一個地方。 -->
        <div class="hc-code">
          <template v-if="applied">
            <span class="hc-code-on">{{ t('handbook.couponApplied', { code: applied.code }) }}</span>
            <button class="hc-code-drop" @click="dropCode">{{ t('handbook.couponRemove') }}</button>
          </template>
          <template v-else>
            <input
              v-model="code"
              class="hc-code-in"
              :placeholder="t('handbook.couponPlaceholder')"
              autocapitalize="characters"
              autocomplete="off"
              @keyup.enter="applyCode"
            >
            <button class="hc-code-go" :disabled="!code.trim() || checkingCode" @click="applyCode">
              {{ t('handbook.couponApply') }}
            </button>
          </template>
        </div>
        <p v-if="codeError" class="hc-code-err">{{ codeError }}</p>
        <!-- 套用成功後的那一行是折扣碼自己的對外文案（後台的「玩家看到的說明」），
             不是後台備註 —— 它的用途是讓人確認「我套到的是哪一張」。 -->
        <p v-else-if="applied?.label" class="hc-code-note">{{ applied.label }}</p>

        <!-- 三件事在付錢之前講完。單筆繳清沒有自動續約，而「以為會自動續」正是這種模式
             最容易產生的誤會。 -->
        <ul class="hc-terms">
          <li>{{ t('handbook.termOnce') }}</li>
          <li>{{ t('handbook.termNoAuto') }}</li>
          <li>{{ t('handbook.termRemind') }}</li>
        </ul>

        <!-- App 內嵌瀏覽器會讓綠界付款頁整個打不開，而且不會有錯誤訊息。說在按下去之前，
             不是按下去之後。 -->
        <p v-if="embedded" class="hc-warn">{{ t('handbook.inAppBrowser', { app: embedded }) }}</p>

        <button class="hc-cta" @click="pay">{{ t('handbook.payNow', { n: amount }) }}</button>
        <div class="hc-gw">{{ t('handbook.gateway') }}</div>
      </template>

      <!-- 條款。消保法第 19 條七日解除權的排除，法律上要的就是「事先告知」加「事先同意」
           這兩件事，所以它們必須發生在錢離開之前、而且要是一個獨立的動作。 -->
      <template v-else-if="state === 'terms'">
        <button class="hc-x" :aria-label="t('common.back')" @click="state = 'idle'">✕</button>
        <h2 class="hc-title">{{ t('handbook.termsTitle') }}</h2>

        <p class="hc-msg hc-left">{{ t('handbook.termsIntro') }}</p>
        <p class="hc-key">{{ t('handbook.termsNoRefund') }}</p>
        <p class="hc-msg hc-left">{{ t('handbook.termsStillOk') }}</p>
        <p class="hc-msg hc-left">{{ t('handbook.termsPeriod', { date: endsOn }) }}</p>

        <label class="hc-agree">
          <input v-model="agreed" type="checkbox">
          <span>{{ t('handbook.termsAgree') }}</span>
        </label>

        <button class="hc-cta" :disabled="!agreed" @click="startPayment">
          {{ t('handbook.termsCta', { n: amount }) }}
        </button>
      </template>

      <template v-else-if="state === 'paying' || state === 'checking'">
        <div class="hc-wait">
          <div class="hc-spin" aria-hidden="true"></div>
          <div>{{ state === 'paying' ? t('handbook.redirecting') : t('handbook.confirming') }}</div>
        </div>
      </template>

      <!-- 付完款回來，但這個瀏覽器現在沒有身分（例如中途在別的分頁登出了）。訂單還在，
           只是要先證明是誰的才看得到 —— 所以是「去登入」，不是「付款失敗」。 -->
      <template v-else-if="state === 'signin'">
        <div class="hc-result">
          <h2 class="hc-title">{{ t('handbook.signInTitle') }}</h2>
          <p class="hc-msg">{{ t('handbook.signInOrder') }}</p>
          <button class="hc-cta" @click="emit('signIn')">{{ t('handbook.goSignIn') }}</button>
        </div>
      </template>

      <!-- 查了二十秒還是 pending。**這不是失敗** —— 綠界的通知可能只是還沒到，錢說不定
           已經收了。寫成失敗會讓人再付一次。 -->
      <template v-else-if="state === 'pending'">
        <div class="hc-result">
          <div class="hc-mark hc-mark-wait" aria-hidden="true">…</div>
          <h2 class="hc-title">{{ t('handbook.pendingTitle') }}</h2>
          <p class="hc-msg">{{ t('handbook.pendingBody') }}</p>
          <button class="hc-cta" @click="emit('done')">{{ t('common.back') }}</button>
        </div>
      </template>

      <template v-else>
        <div class="hc-result" :class="state">
          <div class="hc-mark" aria-hidden="true">{{ state === 'paid' ? '✓' : '!' }}</div>
          <h2 class="hc-title">{{ state === 'paid' ? t('handbook.paidTitle') : t('handbook.failedTitle') }}</h2>
          <p class="hc-msg">
            {{ state === 'paid'
              ? t('handbook.paidBody', { plan: planName, date: endsOn })
              : t('handbook.failedBody') }}
          </p>
          <!-- 後端記下的原因原樣顯示：「金額不符」跟「卡片被拒」要做的事完全不同，
               統一成一句「付款失敗」等於把人推去客服。 -->
          <p v-if="state === 'failed' && failure" class="hc-why">{{ failure }}</p>
          <button class="hc-cta" @click="state === 'paid' ? emit('done') : (state = 'idle')">
            {{ state === 'paid' ? t('handbook.startReading') : t('handbook.tryAgain') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hc {
  position: fixed;
  inset: 0;
  z-index: 9600;
  background: rgba(20, 16, 10, 0.66);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 28px;
}
.hc-sheet {
  position: relative;
  width: 100%;
  max-width: 840px;
  /* 內容比畫面高就自己捲。這張單的長度會變 —— 多一筆折扣、多一段條款、換成英文，
     每一樣都會把它推高；沒有上限的話超出去的那截是直接看不到的，而最底下那一截
     正是付款鍵。 */
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 44px 40px 48px;
  border-radius: 28px;
  background: #EDE0C8;
  color: #3E2F22;
  font-family: var(--ui-cjk);
}
.hc-x {
  position: absolute;
  top: 24px;
  right: 24px;
  width: 60px;
  height: 60px;
  border: 0;
  border-radius: 16px;
  background: rgba(62, 47, 34, 0.1);
  color: #3E2F22;
  font-size: 28px;
  cursor: pointer;
}
.hc-title { margin: 0 68px 28px 0; font-size: 38px; font-weight: 800; letter-spacing: 0.04em; }

.hc-rows { margin: 0 0 28px; }
.hc-rows > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 0;
  border-bottom: 1px solid rgba(195, 167, 127, 0.5);
}
.hc-rows dt { font-size: 24px; color: #7A6753; }
.hc-rows dd { margin: 0; font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.hc-total { border-bottom: 0 !important; padding-top: 24px !important; }
.hc-total dd { font-size: 44px; font-weight: 800; }
.hc-cut dd { color: #A8571F; }
.hc-codetag {
  margin-left: 12px;
  padding: 2px 12px;
  border-radius: 999px;
  background: rgba(168, 87, 31, 0.14);
  color: #A8571F;
  font-size: 20px;
  font-weight: 700;
}
.hc-was { margin-right: 12px; font-size: 26px; font-weight: 400; color: #9A8771; text-decoration: line-through; }

.hc-code { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
.hc-code-in {
  flex: 1;
  min-width: 0;
  padding: 18px 20px;
  border: 1px solid #C3A77F;
  border-radius: 16px;
  background: rgba(255, 252, 244, 0.7);
  color: #3E2F22;
  font: inherit;
  font-size: 26px;
  text-transform: uppercase;
}
.hc-code-in:focus { outline: none; border-color: #3E2F22; }
.hc-code-go {
  flex: none;
  padding: 18px 28px;
  border: 1px solid #3E2F22;
  border-radius: 16px;
  background: none;
  color: #3E2F22;
  font: inherit;
  font-size: 26px;
  font-weight: 700;
  cursor: pointer;
}
.hc-code-go:disabled { opacity: 0.4; cursor: not-allowed; }
.hc-code-on { flex: 1; font-size: 26px; font-weight: 700; color: #A8571F; }
.hc-code-drop {
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  color: #7A6753;
  font: inherit;
  font-size: 24px;
  text-decoration: underline;
  cursor: pointer;
}
.hc-code-err { margin: -6px 0 24px; font-size: 24px; color: #8A4718; }
.hc-code-note { margin: -6px 0 24px; font-size: 24px; color: #7A6753; }

.hc-terms { margin: 0 0 32px; padding-left: 36px; }
.hc-terms li { font-size: 24px; line-height: 1.8; color: #6B5944; }

.hc-cta {
  width: 100%;
  padding: 24px 28px;
  border: 0;
  border-radius: 999px;
  background: #3E2F22;
  color: #F0E4CC;
  font: inherit;
  font-size: 30px;
  font-weight: 800;
  cursor: pointer;
}
.hc-gw { margin-top: 20px; font-size: 22px; text-align: center; color: #9A8771; }

.hc-left { text-align: left; }
/* 要被排除的那一條權利，不能跟其他說明長得一樣。 */
.hc-key {
  margin: 0 0 24px;
  padding: 20px 24px;
  border-radius: 16px;
  border: 1px solid rgba(168, 87, 31, 0.4);
  background: rgba(168, 87, 31, 0.1);
  font-size: 25px;
  line-height: 1.8;
  color: #8A4718;
}
.hc-agree {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin: 0 0 28px;
  font-size: 26px;
  line-height: 1.7;
  cursor: pointer;
}
.hc-agree input { margin-top: 6px; flex: none; width: 34px; height: 34px; accent-color: #3E2F22; }
.hc-cta:disabled { opacity: 0.45; cursor: not-allowed; }

.hc-wait { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 60px 0; font-size: 28px; }
.hc-spin {
  width: 60px;
  height: 60px;
  border: 3px solid rgba(62, 47, 34, 0.18);
  border-top-color: #3E2F22;
  border-radius: 50%;
  animation: hc-turn 0.9s linear infinite;
}
@keyframes hc-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .hc-spin { animation-duration: 3s; } }

.hc-warn {
  margin: 0 0 24px;
  padding: 18px 22px;
  border-radius: 16px;
  background: rgba(168, 87, 31, 0.12);
  border: 1px solid rgba(168, 87, 31, 0.35);
  font-size: 24px;
  line-height: 1.7;
  color: #8A4718;
}
.hc-why {
  margin: -8px 0 32px;
  font-size: 24px;
  color: #8A4718;
}
.hc-mark-wait { background: rgba(62, 47, 34, 0.14); color: #3E2F22; }
.hc-result { text-align: center; }
.hc-mark {
  width: 104px;
  height: 104px;
  margin: 8px auto 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 52px;
  font-weight: 800;
}
.hc-result.paid .hc-mark { background: #3E2F22; color: #F0E4CC; }
.hc-result.failed .hc-mark { background: #A8571F; color: #FFF; }
.hc-result .hc-title { margin: 0 0 16px; }
.hc-msg { margin: 0 0 36px; font-size: 26px; line-height: 1.8; color: #6B5944; }
</style>
