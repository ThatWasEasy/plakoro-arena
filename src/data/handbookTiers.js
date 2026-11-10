// Who may read what.
//
// 販售方式是訂閱，不是單本買斷：方案有高低，高的包含低的，所以「有沒有權限」
// 永遠是比兩個位置，不是查一張持有清單。
//
// 階梯與每一冊的要求由後台決定（API 的 handbook_tiers / handbook_access），切書時算出來的
// tier 只當預設值。兩層的分工是：**改價格、改某一章要哪一檔，是後台點一下；新增一冊，
// 切書就給它一個合理的預設，不用先進後台點一輪。** 後台沒回應時整份退回預設值，
// 書架不會因為權限服務掛掉而變成一片空白。
import { computed, ref } from 'vue'

const EMPTY = { order: [], meta: {} }

const ladder = ref(EMPTY)

/**
 * 現在這份階梯是不是伺服器給的。
 *
 * false 代表 /api/handbook/tiers 讀不到，畫面退回了 manifest 裡切書時算的那一份。
 * 那份是「還沒有人碰後台之前」的預設值，不是後台現在的設定 —— 伺服器執行的永遠是
 * 資料庫那一份，所以這種時候兩邊可能不一樣。
 *
 * 它只影響「要不要把章數講出來」。鎖與閱讀照舊：真正的規則是伺服器的 404，前端這份
 * 從頭到尾都只是為了讓畫面不要空白。
 */
export const ladderIsLive = ref(false)

/**
 * 書店開了沒。預設關著 —— 還沒問到伺服器之前寧可說「即將上線」，也不要讓人點進一個
 * 會回 404 的書架。
 *
 * 值來自後台（handbook_shop），不是 build 時的旗標：開不開賣跟「哪一冊要哪一檔方案」
 * 是同一類決定，不該是一次重新部署。
 */
export const shopOpen = ref(false)

/** 讀者目前的方案 key；null 代表沒訂閱（或已過期）。 */
export const myTier = ref(null)

/** 到期日 'YYYY-MM-DD'，null 表示不過期。只拿來顯示，有效與否是伺服器判定的。 */
export const myExpiresOn = ref(null)

/**
 * 忘掉「現在這個人是誰」。登出、或換一個帳號登入時呼叫。
 *
 * 只清訂閱，不清階梯與每一冊的要求 —— 那些是**書**的設定，不是誰的身分，清掉只會讓
 * 書架變成一片空白。
 */
export function forgetMine() {
  myTier.value = null
  myExpiresOn.value = null
}

/** 後台設定的 unitId → tier，蓋過 manifest 裡的預設值。 */
const overrides = ref({})

/** 正在免費試讀的 unitId → 最後一天 'YYYY-MM-DD'。期限內無視原本要求的方案。 */
const freeUntil = ref({})
// 下架中的冊子：id → 封面要帶的那條字。有值就是下架。
const holds = ref({})

/**
 * 可以買的期間與折扣，由伺服器給。
 *
 * 前端不自己留一份價目表 —— 畫面上的數字跟綠界實際扣的款必須來自同一個地方，不然總有
 * 一天會寫著一個價、收另一個價。伺服器沒回應時才用這份退路（看得到方案頁，只是折扣
 * 可能是舊的）。
 */
export const periods = ref([
  { key: 'm', months: 1, free: 0 },
  { key: 'q', months: 3, free: 1 },
  { key: 'y', months: 12, free: 4 }
])

export const tierLadder = ladder

/** 退路：manifest 裡切書時算的階梯。只有伺服器讀不到時才會走到這裡。 */
export function setLadder(t) {
  ladder.value = t && Array.isArray(t.order) ? t : EMPTY
  ladderIsLive.value = false
}

/**
 * 套用 /api/handbook/tiers 回來的內容。
 *
 * 伺服器的階梯是 [{key, rank, name, usd}]，前端要的是 order + meta，
 * 在這裡轉一次，其他地方就只認得一種形狀。
 */
export function applyServerConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.tiers) || !cfg.tiers.length) return false
  const meta = {}
  for (const t of cfg.tiers) {
    meta[t.key] = {
      name: t.name, usd: t.usd, hidden: !!t.hidden,
      // 這一檔是給誰的，以及它包含什麼。書架答得出「解鎖幾章」，但人在決定要不要
      // 付錢時問的是這兩件事。
      tagline: t.tagline || '',
      perks: t.perks || ''
    }
  }
  ladder.value = { order: cfg.tiers.map(t => t.key), meta }
  overrides.value = cfg.access || {}
  freeUntil.value = cfg.freeUntil || {}
  holds.value = cfg.holds || {}
  shopOpen.value = !!cfg.open
  ladderIsLive.value = true
  if (Array.isArray(cfg.periods) && cfg.periods.length) periods.value = cfg.periods
  myTier.value = cfg.mine?.tier || null
  myExpiresOn.value = cfg.mine?.expiresOn || null
  return true
}

/** 這一冊實際要求的方案：後台設定優先，沒有就用切書時算的。 */
export function tierFor(unit) {
  if (!unit) return null
  return overrides.value[unit.id] || unit.tier || null
}

/** 在階梯上的位置，愈大愈高；不認得的方案回 -1。 */
export function rankOf(key) {
  return key ? ladder.value.order.indexOf(key) : -1
}

/** 方案的名稱與價格，給畫面用。 */
export function metaOf(key) {
  return (key && ladder.value.meta[key]) || null
}

/**
 * `mine` 這個方案能不能看 `needed`。
 *
 * needed 是 null 的時候一律不行 —— 那表示切書與後台都沒有任何方案對應到這一冊，
 * 是設定漏了，不是「免費」。寧可鎖住，也不要把還沒上架的內容送出去。
 */
export function covers(mine, needed) {
  const want = rankOf(needed)
  return want >= 0 && rankOf(mine) >= want
}

/**
 * 這一冊目前是不是免費試讀，是的話回最後一天。
 *
 * 跟方案無關 —— 它是階梯的例外，不是階梯上的一個位置。所以判斷權限時要在比較 rank
 * 之前先問它，順序反過來就等於沒有這個功能。
 */
export function freeReadUntil(unit) {
  return (unit && freeUntil.value[unit.id]) || null
}

/**
 * 這一冊是不是下架中，是的話回封面要帶的那條字（預設「監修中」）。
 *
 * 下架跟「要求更高的方案」是兩件事：後者是還沒買，前者是現在誰都不給讀，包含已經
 * 買到那一檔的人。內容改到一半的時候，讓付過錢的人讀到半成品比讓他暫時讀不到糟。
 */
export function holdLabel(unit) {
  return (unit && holds.value[unit.id]) || null
}

/** 這一冊讀者看不看得到。 */
export function unlocked(unit) {
  // 下架蓋過一切，連免費試讀都蓋過 —— 試讀是「放寬誰讀得到」，下架是「這份東西現在
  // 不給讀」，兩個同時成立的時候後者才是真的意思。伺服器那邊是同樣的順序。
  if (holdLabel(unit)) return false
  return !!freeReadUntil(unit) || covers(myTier.value, tierFor(unit))
}

/**
 * 要不要對這個人說「免費試閱」。
 *
 * 自己的方案本來就涵蓋這一章的人不顯示：對他們來說這不是優惠，講了只會讓人以為自己
 * 付的錢買到的東西別人免費就有。
 */
export function showsFreeBadge(unit) {
  return !!freeReadUntil(unit) && !covers(myTier.value, tierFor(unit))
}

/**
 * 跟伺服器問一次書店狀態與方案階梯。
 *
 * 首頁就要知道 —— 「秘笈手冊」那張卡片要不要顯示「即將上線」取決於它。拿不到就維持
 * 關著：少一個入口比給一個點進去是 404 的入口好。
 */
export async function refreshHandbookShop() {
  const { fetchTierConfig } = await import('./handbookSource')
  const cfg = await fetchTierConfig()
  if (cfg) applyServerConfig(cfg)
}
