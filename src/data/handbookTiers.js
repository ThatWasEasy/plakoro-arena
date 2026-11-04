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

const EMPTY = { order: [], meta: {}, join: '' }

const ladder = ref(EMPTY)

/** 讀者目前的方案 key；null 代表沒訂閱（或已過期）。 */
export const myTier = ref(null)

/** 到期日 'YYYY-MM-DD'，null 表示不過期。只拿來顯示，有效與否是伺服器判定的。 */
export const myExpiresOn = ref(null)

/** 後台設定的 unitId → tier，蓋過 manifest 裡的預設值。 */
const overrides = ref({})

export const tierLadder = ladder

export function setLadder(t) {
  ladder.value = t && Array.isArray(t.order) ? t : EMPTY
}

/**
 * 套用 /api/handbook/tiers 回來的內容。
 *
 * 伺服器的階梯是 [{key, rank, name, usd, joinUrl}]，前端要的是 order + meta，
 * 在這裡轉一次，其他地方就只認得一種形狀。
 */
export function applyServerConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.tiers) || !cfg.tiers.length) return false
  const meta = {}
  for (const t of cfg.tiers) meta[t.key] = { name: t.name, usd: t.usd, joinUrl: t.joinUrl }
  ladder.value = {
    order: cfg.tiers.map(t => t.key),
    meta,
    // 階梯層級的 join 用最低階那檔的連結當退路：沒設定時至少還連得到贊助頁。
    join: cfg.tiers.find(t => t.joinUrl)?.joinUrl || ''
  }
  overrides.value = cfg.access || {}
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

export const joinUrl = computed(() => ladder.value.join || '')

/** 某個方案自己的 Patreon 結帳連結，沒設定就退回活動首頁。 */
export function joinUrlFor(key) {
  return metaOf(key)?.joinUrl || ladder.value.join || ''
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

/** 這一冊讀者看不看得到。 */
export function unlocked(unit) {
  return covers(myTier.value, tierFor(unit))
}
