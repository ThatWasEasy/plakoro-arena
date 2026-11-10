<script setup>
// 訂閱方案：每一檔多少錢、解鎖哪幾章。
//
// 這一頁存在的理由是「Pro 到底比 Basic 多什麼」在書架上回答不了 —— 書架說的是一本一本
// 的鎖，而人在決定要不要付錢時問的是一整檔的範圍。所以這裡的單位是方案，不是書。
//
// 解鎖清單是從 manifest 和後台的 handbook_access 算出來的，不是另外維護的文案。少了這點，
// 某一章改了要求方案之後，這頁就會開始說謊 —— 而這頁說謊是會收到錢的那種謊。
//
// 賣的是「一段期間」而不是自動續訂：金流端目前只有單筆繳清，所以期滿就是期滿，不會自己
// 扣下一期。年繳給比較多的折扣正是為了這件事 —— 手動續訂的痛點是回訪頻率，一年一次和
// 自動續訂在體感上差不多，一個月一次就不是了。
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isSignedIn } from '../../data/currentPlayer'
import { ladderIsLive, metaOf, myExpiresOn, myTier, periods, rankOf, tierFor, tierLadder } from '../../data/handbookTiers'

const props = defineProps({
  // 整本書，用來算每一檔解鎖幾章。
  units: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'pick', 'reload'])
const { t } = useI18n()

// 一個月的價格乘以期數，再扣掉折抵的月數。折扣寫成「送幾個月」而不是百分比，因為那是
// 使用者實際在比的東西 —— 「年繳送四個月」比「打六七折」好懂，也好在畫面上說。
// 期間與折扣由伺服器給（見 handbookTiers.js 的 periods）。這一頁只負責顯示 ——
// 同一份數字後端也拿去算綠界要收多少。
// 預設月繳 —— 第一次看到的數字要是「最低多少錢可以開始」，不是「最划算的總價」。
// 年繳那個四位數擺在第一眼會先把人嚇走，而折扣在他決定要買之後才有說服力。
// 用 computed 追著 periods 走，因為它是伺服器給的，第一次 render 時可能還是退路那份。
const picked = ref('')
const period = computed(() => periods.value.find(p => p.key === picked.value) || periods.value[0])

// 'free' 是「沒訂閱」在階梯上的位置，不是一檔商品，所以不陳列。hidden 是後台按下「暫時
// 下架」的那些 —— 階梯照舊、已經訂了的人照舊看得到，只是不再賣。
//
// 注意 addedBy() 是拿「清單上的前一檔」當基準，所以下架一檔之後，它底下那一檔的「比前
// 一檔多」會自動把被下架那檔的範圍算進去，不會在清單上留一個跳號的洞。
const sellable = computed(() =>
  tierLadder.value.order
    .filter(k => k !== 'free' && !metaOf(k)?.hidden)
    .map(k => ({ key: k, ...metaOf(k) })))

/** 這一檔的好處，一行一項。開頭有空白的是上一項的子項。 */
function perkLines(tier) {
  return String(tier.perks || '')
    .split('\n')
    .filter(line => line.trim())
    .map(line => ({ text: line.trim(), sub: /^\s/.test(line) }))
}

function priceOf(tier) {
  const monthly = Number(tier.usd) || 0
  return monthly * (period.value.months - period.value.free)
}
function fullPriceOf(tier) {
  return (Number(tier.usd) || 0) * period.value.months
}

/** 這一檔解鎖哪些章 —— 包含它自己的，也包含它涵蓋的所有低階。 */
function unitsFor(key) {
  const want = rankOf(key)
  return props.units.filter(u => {
    const need = rankOf(tierFor(u))
    return need >= 0 && need <= want
  })
}
/** 比前一檔「多」解鎖的那些。買 Pro 的人想知道的是這個，不是總數。 */
function addedBy(key) {
  const i = sellable.value.findIndex(x => x.key === key)
  const prev = i > 0 ? sellable.value[i - 1].key : 'free'
  const base = new Set(unitsFor(prev).map(u => u.id))
  return unitsFor(key).filter(u => !base.has(u.id))
}

const expanded = ref('')
const isMine = key => myTier.value === key
const isBelow = key => rankOf(key) < rankOf(myTier.value)

// 訂閱是記在帳號上的，不是記在這台裝置上 —— 換手機、換瀏覽器都要讀得到，所以買之前
// 得先有一個帳號。價目可以隨便看，但按鈕要先說實話：訪客按下去是去登入，不是去付款。
function ctaLabel(key) {
  if (!isSignedIn.value) return t('handbook.subscribeSignIn')
  if (isMine(key)) return t('handbook.extend')
  return isBelow(key) ? t('handbook.switchDown') : t('handbook.subscribe')
}

function endDate() {
  const from = myExpiresOn.value ? new Date(myExpiresOn.value) : new Date()
  const base = from > new Date() ? from : new Date()
  const d = new Date(base)
  d.setMonth(d.getMonth() + period.value.months)
  return d.toISOString().slice(0, 10)
}
</script>

<template>
  <div class="hp" @click.self="emit('close')">
    <div class="hp-sheet">
      <button class="hp-x" :aria-label="t('common.back')" @click="emit('close')">✕</button>
      <h2 class="hp-title">{{ t('handbook.plansTitle') }}</h2>
      <p class="hp-lede">{{ t('handbook.plansLede') }}</p>

      <!-- 讀不到伺服器那份設定就不賣。
           退路是 manifest 裡切書時帶的那一份，而它帶的是 Patreon 時代的原型價格
           （basic 3 / pro 5 / master 8）—— 照著畫出來的話，畫面會標 NT$ 3，伺服器照樣
           收 49。章數講錯是誤導，價格講錯是另一回事。 -->
      <div v-if="!ladderIsLive" class="hp-down">
        <p>{{ t('handbook.plansUnavailable') }}</p>
        <button class="hp-cta" @click="emit('reload')">{{ t('app.retry') }}</button>
      </div>

      <template v-else>
      <!-- 期間先選，因為它會改掉下面每一張卡的價格。擺在方案之後的話，使用者會先比完價
           再發現價格會變。 -->
      <div class="hp-periods">
        <button
          v-for="p in periods"
          :key="p.key"
          class="hp-period"
          :class="{ on: p.key === period.key }"
          @click="picked = p.key"
        >
          <span>{{ t(`handbook.period.${p.key}`) }}</span>
          <span v-if="p.free" class="hp-save">{{ t('handbook.periodSave', { n: p.free }) }}</span>
        </button>
      </div>

      <div class="hp-cards">
        <article
          v-for="tier in sellable"
          :key="tier.key"
          class="hp-card"
          :class="{ mine: isMine(tier.key) }"
        >
          <div class="hp-card-head">
            <div class="hp-name">{{ (tier.name || '').split('｜')[0] }}</div>
            <div class="hp-sub">{{ (tier.name || '').split('｜').slice(1).join('｜') }}</div>
            <!-- 這一檔是給誰的。一句話，放在價格之前 —— 人要先知道自己是不是那個人，
                 才會去看多少錢。 -->
            <p v-if="tier.tagline" class="hp-tagline">「{{ tier.tagline }}」</p>
          </div>

          <div class="hp-price">
            <span class="hp-cur">NT$</span>
            <span class="hp-amt">{{ priceOf(tier) }}</span>
            <span class="hp-per">{{ t(`handbook.perPeriod.${period.key}`) }}</span>
          </div>
          <div v-if="period.free" class="hp-was">
            {{ t('handbook.wasPrice', { n: fullPriceOf(tier) }) }}
          </div>

          <!-- 後台寫的好處清單。章節數是機器算出來的事實，這一串是人寫的賣點，
               兩個都要有：一個回答「拿得到什麼」，一個回答「那是什麼」。 -->
          <ul v-if="perkLines(tier).length" class="hp-perks">
            <li v-for="(p, i) in perkLines(tier)" :key="i" :class="{ sub: p.sub }">{{ p.text }}</li>
          </ul>

          <!-- 章節數放在好處清單之後，而且是小字：它是一個事實，不是這一檔的賣點。
               原本這裡還有一顆「比前一階級多 N 章」的標籤，拿掉了 —— 章只有 27 篇，
               愈上面的階級能「多」的愈少，那個數字必然讓最高階看起來最弱，而它真正
               貴在 DLC、前瞻與討論群，那些一章都不算。 -->
          <button v-if="ladderIsLive" class="hp-toggle" @click="expanded = expanded === tier.key ? '' : tier.key">
            {{ expanded === tier.key ? t('handbook.hideList') : t('handbook.showList') }}
          </button>
          <ul v-if="expanded === tier.key" class="hp-list">
            <li v-for="u in unitsFor(tier.key)" :key="u.id" :class="{ fresh: addedBy(tier.key).some(a => a.id === u.id) }">
              <span>{{ u.title }}</span>
              <span class="hp-pg">{{ t('handbook.pages', { n: u.pages }) }}</span>
            </li>
          </ul>

          <div class="hp-foot">
            <span v-if="isMine(tier.key)" class="hp-badge">{{ t('handbook.currentPlan') }}</span>
            <button class="hp-cta" :class="{ sub: isBelow(tier.key) }" @click="emit('pick', { tier, period })">
              {{ ctaLabel(tier.key) }}
            </button>
          </div>
        </article>
      </div>

      <!-- 單筆繳清沒有自動續約，這件事要在付錢之前講，不是在到期之後才讓人發現。 -->
      <div class="hp-note">
        <div class="hp-note-head">{{ t('handbook.manualRenewTitle') }}</div>
        <p>{{ t('handbook.manualRenewBody', { date: endDate() }) }}</p>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* #stage 之外，所以全部用 px —— 跟 HandbookDetail 同一套理由。 */
.hp {
  position: fixed;
  inset: 0;
  z-index: 9500;
  background: rgba(20, 16, 10, 0.62);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 48px 24px calc(64px + env(safe-area-inset-bottom));
}
.hp-sheet {
  position: relative;
  width: 100%;
  max-width: 1520px;
  padding: 44px 36px 52px;
  border-radius: 28px;
  background: #EDE0C8;
  color: #3E2F22;
  font-family: var(--ui-cjk);
}
.hp-x {
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
.hp-title { margin: 0 68px 8px 0; font-size: 40px; font-weight: 800; letter-spacing: 0.04em; }
.hp-lede { margin: 0 0 32px; font-size: 26px; line-height: 1.7; color: #7A6753; }

.hp-periods { display: flex; gap: 16px; margin-bottom: 36px; }
.hp-period {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 12px;
  border: 1px solid #C3A77F;
  border-radius: 18px;
  background: none;
  color: #7A6753;
  font: inherit;
  font-size: 26px;
  font-weight: 700;
  cursor: pointer;
}
.hp-period.on { background: #3E2F22; border-color: #3E2F22; color: #F0E4CC; }
.hp-save { font-size: 20px; font-weight: 700; color: #A8571F; letter-spacing: 0.02em; }
.hp-period.on .hp-save { color: #E8B57A; }

.hp-cards { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.hp-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 32px 28px;
  border: 1px solid #C3A77F;
  border-radius: 24px;
  background: rgba(255, 252, 244, 0.6);
}
/* 自己這一檔要認得出來，否則「續訂」按鈕看起來就只是另一個「訂閱」。 */
.hp-card.mine { border-color: #3E2F22; border-width: 2px; }
.hp-name { font-size: 32px; font-weight: 800; }
.hp-sub { font-size: 22px; color: #7A6753; }
.hp-tagline { margin: 12px 0 0; font-size: 26px; font-weight: 700; color: #3E2F22; }

.hp-perks { margin: 0; padding: 0; list-style: none; }
.hp-perks li {
  position: relative;
  padding-left: 24px;
  font-size: 24px;
  line-height: 1.75;
  color: #4A3B2A;
}
.hp-perks li::before { content: '•'; position: absolute; left: 0; color: #A8571F; }
/* 子項再縮一格，點換成空心的 —— 層級用形狀分，顏色留給別的事。 */
.hp-perks li.sub { padding-left: 48px; color: #7A6753; }
.hp-perks li.sub::before { content: '◦'; left: 24px; }
.hp-price { display: flex; align-items: baseline; gap: 4px; }
.hp-cur { font-size: 24px; font-weight: 700; }
.hp-amt { font-size: 56px; font-weight: 800; font-variant-numeric: tabular-nums; }
.hp-per { font-size: 22px; color: #7A6753; margin-left: 6px; }
.hp-was { margin-top: -6px; font-size: 22px; color: #9A8771; text-decoration: line-through; }

.hp-toggle {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: #7A6753;
  font: inherit;
  font-size: 22px;
  text-decoration: underline;
  cursor: pointer;
}
.hp-list { margin: 0; padding: 0; list-style: none; max-height: 380px; overflow-y: auto; }
.hp-list li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(195, 167, 127, 0.4);
  font-size: 24px;
}
/* 比前一檔多出來的那些 —— 這一檔的理由就在這幾行上。 */
.hp-list li.fresh { font-weight: 700; color: #A8571F; }
.hp-pg { flex: none; font-size: 22px; color: #9A8771; font-variant-numeric: tabular-nums; }

.hp-foot { margin-top: auto; padding-top: 12px; display: flex; flex-direction: column; gap: 12px; }
.hp-badge {
  align-self: flex-start;
  padding: 4px 16px;
  border-radius: 999px;
  background: #3E2F22;
  color: #F0E4CC;
  font-size: 20px;
  font-weight: 700;
}
.hp-cta {
  padding: 20px 28px;
  border: 0;
  border-radius: 999px;
  background: #3E2F22;
  color: #F0E4CC;
  font: inherit;
  font-size: 28px;
  font-weight: 800;
  cursor: pointer;
}
.hp-cta.sub { background: none; border: 1px solid #C3A77F; color: #7A6753; }

.hp-note {
  margin-top: 36px;
  padding: 24px 28px;
  border-radius: 20px;
  background: rgba(62, 47, 34, 0.07);
}
.hp-note-head { font-size: 24px; font-weight: 800; letter-spacing: 0.1em; margin-bottom: 8px; }

.hp-down { padding: 48px 8px; text-align: center; }
.hp-down p { margin: 0 0 24px; font-size: 26px; line-height: 1.8; color: #7A6753; }
.hp-down .hp-cta { display: inline-block; padding: 20px 48px; }
.hp-note p { margin: 0; font-size: 24px; line-height: 1.75; color: #6B5944; }
</style>
