<!-- 公告列表。主畫面左下角的信封點開的就是這個。
     未讀是**這台裝置**的事（見 data/announcements.js）——換一台手機就會全部重新亮起來，
     那是刻意的：公告不需要登入就看得到，而最需要被看到的那一則常常正是對著還沒登入的
     人發的。 -->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { announcements, isRead, markAllRead, markRead } from '../../data/announcements'
import { claimedGifts, giftCount, hasGifts, pendingGifts } from '../../data/gifts'
import { describeAsset } from '../../data/assetCatalogue'
import { pointReason } from '../../data/pointReason'
import Icon from '../Icon.vue'

const emit = defineEmits(['close', 'gifts', 'gift'])
const { t } = useI18n()

// 左邊選哪一列，右邊就顯示那一列。
const open = ref(null)

/**
 * 這一列還需要被看一眼嗎。
 *
 * 讀過沒用的是信箱列的 id（公告 'a3'、禮物 'gu12'），所有信件共用同一份紀錄 ——
 * 一個紅點在不同種類的信上該是同一個意思。
 *
 * 唯一的例外是還沒領的禮物：它要的不是「看過」，是「領走」，所以在領走之前點一直亮。
 */
function unread(r) {
  return (r.gift && !r.taken) || !isRead(r.rowId)
}

/* ── 信件 ─────────────────────────────────────────────────────────────────
   禮物在這裡是一封一封的信：有標題、有內文、看得到是哪場賽事給的。但**領取仍然是
   一次全領** —— 伺服器那支就是這樣設計的（見 /api/players/me/gifts/claim：開到一半
   的一疊是沒有人想回來面對的狀態）。兩件事不衝突，只要按鈕說實話：N 件以上時它寫的
   就是「全部領取 N 件」，按哪一封都一樣。
*/
const KIND_LABELS = {
  avatar: 'profile.avatar', background: 'profile.flag',
  title: 'profile.titleLabel', points: 'points.name'
}

function giftTitle(g) {
  if (g.kind === 'points') return `+${g.points} PTP`
  return describeAsset(g.kind, g.asset)?.name || g.asset
}
function giftKind(g) {
  const key = KIND_LABELS[g.kind]
  return key ? t(key) : g.kind
}
/** 為什麼拿到這個。沒有這一行，一面旗子就只是一張圖。跟拆禮畫面用同一套判斷。 */
function giftFrom(g) {
  if (g.kind === 'points') return pointReason(g, t)
  const entry = describeAsset(g.kind, g.asset)
  if (g.src && g.src.startsWith('manual:')) return g.note || entry?.obtain || t('gift.fromOrganiser')
  return entry?.obtain || g.tournament_name || t('gift.fromOrganiser')
}

/* ── 一個信箱，一條時間軸 ─────────────────────────────────────────────────
   禮物與公告都是「寄來的東西」，所以不分區，全部照收到的日期由新到舊排。

   排序的鍵是**收到的那一天**，不是領取的那一天 —— 領完之後那一列要留在原地。會跳走
   的清單等於要人每拆一封就重新找一次位置，而那正是他剛剛在看的東西。
*/
const letters = computed(() => pendingGifts.value.map(g => ({ ...g, rowId: `g${g.id}`, gift: true, taken: false, cat: 'gift' })))
const opened = computed(() => claimedGifts.value.map(g => ({ ...g, rowId: `g${g.id}`, gift: true, taken: true, cat: 'gift' })))
const notes = computed(() => announcements.value.map(a => ({
  ...a, rowId: `a${a.id}`, gift: false, taken: false,
  // 伺服器沒給或給了不認得的，一律當公告 —— 跑到沒人會找的分頁比分類錯更糟。
  cat: a.category === 'handbook' ? 'handbook' : 'notice'
})))

/** 這一列的日期，YYYY-MM-DD。禮物看送達時間，公告看發布日。 */
function rowDate(r) {
  return r.gift ? String(r.at || '').slice(0, 10) : (r.date || '')
}

/* ── 分類 ─────────────────────────────────────────────────────────────────
   「全部」永遠在第一個，而且是預設 —— 分類是用來找東西的，不是用來把東西藏起來的。
   一個分頁如果一封信都沒有就不陳列，免得點進去看到一片空白。
*/
const CATS = ['all', 'notice', 'gift', 'handbook']
const cat = ref('all')

const allRows = computed(() =>
  [...letters.value, ...opened.value, ...notes.value]
    // 同一天的用 rowId 決勝負，不要靠陣列原本的順序。
    // sort 是穩定的，所以同分時比的是輸入順序 —— 而「待領」與「已領」是兩個陣列接起來
    // 的，領掉一封會讓它從前半段搬到後半段，同一天的那幾列就跟著重排。次鍵只跟那一列
    // 自己有關，位置才不會因為狀態改變而移動。
    .sort((a, b) => rowDate(b).localeCompare(rowDate(a)) || a.rowId.localeCompare(b.rowId)))

const rows = computed(() =>
  (cat.value === 'all' ? allRows.value : allRows.value.filter(r => r.cat === cat.value)))

/** 有東西的分類才出現。數字是「還要處理的」，跟左邊那顆紅點同一個判斷。 */
const tabs = computed(() => CATS
  .map(key => {
    const inCat = key === 'all' ? allRows.value : allRows.value.filter(r => r.cat === key)
    return { key, total: inCat.length, pending: inCat.filter(unread).length }
  })
  .filter(x => x.key === 'all' || x.total))

function pickCat(key) {
  cat.value = key
  // 換分頁時右邊那封信可能已經不在清單上了 —— 跟著選第一封，不要留著一封看不到的信。
  if (!rows.value.some(r => r.rowId === open.value)) {
    const first = rows.value.find(r => r.gift && !r.taken) || rows.value.find(unread) || rows.value[0]
    if (first) select(first)
    else open.value = null
  }
}

const current = computed(() => rows.value.find(r => r.rowId === open.value) || null)

/**
 * 領這一封 —— 交給拆禮畫面去領，不在這裡自己收。
 *
 * 一開始是在這裡直接呼叫 API、把那一列拿掉就算了，結果是東西進了帳號卻沒有人看到它
 * 長什麼樣子。拆開的那一下才是這件事的重點，而那個畫面已經存在了。
 */
function takeOne(row) {
  emit('gift', row.id)
}

onMounted(() => {
  // 一進來先選「還沒處理的」：未領的禮物優先，其次是沒讀過的，都沒有就選最新的一封。
  const first = rows.value.find(r => r.gift && !r.taken)
    || rows.value.find(r => unread(r))
    || rows.value[0]
  if (first) select(first)
})

function select(row) {
  open.value = row.rowId
  markRead(row.rowId)
}

function closeBoard() {
  // 關掉的時候一次收乾淨。逐封點開才算讀，會留下一個永遠剩兩三封的紅點。
  markAllRead(rows.value.map(r => r.rowId))
  emit('close')
}

/** 全部領取。先把清單記成讀過，不然拆完回來會看到一整排沒意義的紅點。 */
function takeAll() {
  markAllRead(rows.value.map(r => r.rowId))
  emit('gifts')
}
</script>

<template>
  <div class="nb" @click.self="closeBoard">
    <div class="nb-sheet">
      <div class="nb-bar">
        <Icon class="nb-bar-icon" name="mail" />
        <span class="nb-bar-title">{{ t('mailbox.title') }}</span>
        <button class="nb-x" :aria-label="t('common.close')" @click="closeBoard"><Icon name="x" /></button>
      </div>

      <!-- 分類列。禮物不在公告那張表裡（它們是玩家的解鎖與點數），所以這一列不是
           伺服器給的欄位清單，是信箱自己的三種東西加上「全部」。 -->
      <nav v-if="allRows.length" class="nb-cats">
        <button
          v-for="c in tabs"
          :key="c.key"
          class="nb-cat"
          :class="{ on: cat === c.key }"
          @click="pickCat(c.key)"
        >
          {{ t(`mailbox.cat.${c.key}`) }}
          <span v-if="c.pending" class="nb-cat-n">{{ c.pending }}</span>
        </button>
      </nav>

      <p v-if="!rows.length" class="nb-empty">{{ t('mailbox.empty') }}</p>

      <!-- 左邊一列標題，右邊內文。兩欄各自捲動 —— 共用一條捲軸的話，讀長公告時左邊
           的清單會跟著跑掉，回頭找上一則就得先捲回去。 -->
      <div v-else class="nb-split">
        <nav class="nb-list">
          <button
            v-for="r in rows"
            :key="r.rowId"
            class="nb-row"
            :class="{ on: open === r.rowId, gift: r.gift }"
            @click="select(r)"
          >
            <span class="nb-dot" :class="{ gone: !unread(r) }" aria-hidden="true"></span>
            <!-- 禮物圖示擺在標題**右邊**，不是左邊：擺左邊的話有圖示的那幾列整段文字
                 都往右推一格，日期就跟公告那幾列對不齊了。 -->
            <span class="nb-row-text">
              <span class="nb-title-line">
                <span class="nb-title" :class="{ taken: r.taken }">{{ r.gift ? giftTitle(r) : r.title }}</span>
                <Icon v-if="r.gift" class="nb-row-gift" name="gift" />
              </span>
              <span class="nb-date">{{ rowDate(r) }}</span>
            </span>
          </button>
        </nav>

        <article v-if="current && current.gift" class="nb-detail">
          <h3 class="nb-detail-title">{{ giftTitle(current) }}</h3>
          <!-- 種類與日期都放在這裡：清單上那一行讓給日期了，但「這是頭像還是稱號」
               仍然是打開一封信最先想知道的事。 -->
          <div class="nb-detail-date">{{ giftKind(current) }} · {{ rowDate(current) }}</div>
          <p class="nb-line">{{ giftFrom(current) }}</p>
          <!-- 這一封，只領這一封。要一次領完的在頁腳。 -->
          <button v-if="!current.taken" class="nb-take" @click="takeOne(current)">{{ t('mailbox.claim') }}</button>
          <div v-else class="nb-taken">{{ t('mailbox.claimed') }}</div>
        </article>

        <article v-else-if="current" class="nb-detail">
          <h3 class="nb-detail-title">{{ current.title }}</h3>
          <div class="nb-detail-date">{{ current.date }}</div>
          <img v-if="current.imageUrl" class="nb-img" :src="current.imageUrl" :alt="current.title">
          <p v-for="(line, i) in (current.body || '').split('\n')" :key="i" class="nb-line">{{ line }}</p>
        </article>
      </div>

      <!-- 多出來的一排，只在有信的時候出現。「全部領取」擺在這裡而不是某一封信裡面：
           它的對象是整個信箱，不是你正在看的那一封。走的是原本那個逐張翻開的畫面。 -->
      <div v-if="hasGifts" class="nb-foot">
        <button class="nb-all" @click="takeAll">{{ t('mailbox.claimAll', { n: giftCount }) }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nb {
  position: fixed;
  inset: 0;
  z-index: 9850;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem 0.75rem calc(1rem + env(safe-area-inset-bottom, 0px));
  background: rgba(40, 40, 38, 0.6);
}
.nb-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* 兩欄要有地方站。比公告只有一列時寬，但仍然放得進手機。 */
  max-width: 34rem;
  height: 82vh; height: 82dvh;
  max-height: 32rem;
  border-radius: 0.875rem;
  background: #FFFDF7;
  color: #1F1F1D;
  overflow: hidden;
}
.nb-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: none;
  padding: 0.75rem 0.5rem 0.75rem 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}
.nb-bar-icon { font-size: 1rem; color: #6B6B66; }
.nb-bar-title { flex: 1; font-size: 0.875rem; font-weight: 800; }
.nb-x {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  background: none;
  color: #6B6B66;
  font-size: 0.875rem;
  cursor: pointer;
}
.nb-empty { margin: auto; padding: 1.5rem 1rem; font-size: 0.8125rem; color: #8A8A82; text-align: center; }

.nb-cats {
  flex: none;
  display: flex;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  overflow-x: auto;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  scrollbar-width: none;
}
.nb-cats::-webkit-scrollbar { display: none; }
.nb-cat {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.3125rem 0.75rem;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  color: #6B6B66;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.nb-cat.on { background: #1A1A18; color: #FFFDF7; }
.nb-cat-n {
  min-width: 1.125rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: #D0401F;
  color: #fff;
  font-size: 0.625rem;
  line-height: 1.125rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* 信箱的頁腳。一排，只有一顆鈕，靠右。 */
.nb-foot {
  flex: none;
  display: flex;
  justify-content: flex-end;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.025);
}
.nb-all {
  padding: 0.3125rem 0.75rem;
  border: 0;
  border-radius: 999px;
  background: #1A1A18;
  color: #fff;
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 800;
  cursor: pointer;
}
.nb-all:active { transform: scale(.97); }

.nb-split {
  flex: 1;
  min-height: 0;
  display: grid;
  /* 左欄跟著寬度走，但有下限 —— 標題窄到一字一行就不是清單了。 */
  grid-template-columns: minmax(7rem, 36%) 1fr;
}

.nb-list {
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.025);
}
.nb-row {
  display: flex;
  align-items: flex-start;
  gap: 0.375rem;
  width: 100%;
  padding: 0.625rem 0.625rem 0.625rem 0.75rem;
  border: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
/* 選中的那一列接到右邊去：底色跟內文同一張紙，右邊界讓開。 */
.nb-row.on {
  background: #FFFDF7;
  margin-right: -1px;
  box-shadow: inset 0.1875rem 0 0 #1F1F1D;
}
.nb-row-text { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.nb-dot {
  flex: none;
  width: 0.4375rem;
  height: 0.4375rem;
  margin-top: 0.3125rem;
  border-radius: 50%;
  background: #D0401F;
  transition: background-color 0.3s;
}
.nb-dot.gone { background: rgba(0, 0, 0, 0.12); }
.nb-title {
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.5;
  /* 兩行為止。標題再長也不該把清單撐成一面牆 —— 完整的在右邊。 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nb-date { font-size: 0.625rem; color: #9A9A92; font-variant-numeric: tabular-nums; }

.nb-title-line { display: flex; align-items: flex-start; gap: 0.25rem; min-width: 0; }
.nb-title-line .nb-title { flex: 1; min-width: 0; }
.nb-row-gift {
  flex: none;
  margin-top: 0.1875rem;
  font-size: 0.8125rem;
  color: #6B6B66;
}
.nb-row.gift .nb-title { color: #1A1A18; }
/* 拆過的信留在清單裡，但不再爭取注意力。 */
.nb-title.taken { color: #9A9A92; font-weight: 600; }

.nb-taken {
  display: inline-block;
  margin-top: 0.75rem;
  padding: 0.3125rem 0.875rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
  color: #8A8A82;
  font-size: 0.75rem;
  font-weight: 800;
}

/* 一封信的動作，所以是一顆小鈕，不是一條佔滿寬度的橫槓。 */
.nb-take {
  margin-top: 0.75rem;
  padding: 0.3125rem 0.875rem;
  border: 0;
  border-radius: 999px;
  background: #1A1A18;
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 800;
  cursor: pointer;
}
.nb-take:active { transform: scale(.97); }
.nb-take:disabled { opacity: 0.5; cursor: not-allowed; }

.nb-detail { min-height: 0; overflow-y: auto; padding: 0.875rem 1rem 1.25rem; }
.nb-detail-title { margin: 0 0 0.125rem; font-size: 0.9375rem; font-weight: 800; line-height: 1.5; }
.nb-detail-date { margin-bottom: 0.625rem; font-size: 0.6875rem; color: #9A9A92; font-variant-numeric: tabular-nums; }
.nb-img { display: block; width: 100%; border-radius: 0.5rem; margin-bottom: 0.625rem; }
.nb-line { margin: 0 0 0.375rem; font-size: 0.8125rem; line-height: 1.8; color: #3A3A35; }
.nb-line:empty { height: 0.5rem; }
</style>
