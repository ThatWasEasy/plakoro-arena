// Thin wrapper around the admin-mode endpoints in server/index.mjs, the same shape as
// authApi.js — every function resolves with the parsed JSON body or throws an Error whose
// message is the server's own `error` string.
import { request } from './apiRequest'

function authHeader(token) {
  return { Authorization: `Bearer ${token}` }
}

export function searchPlayers(token, q) {
  return request(`/api/admin/players?q=${encodeURIComponent(q || '')}`, { headers: authHeader(token) })
}

export function getPlayer(token, code) {
  return request(`/api/admin/players/${encodeURIComponent(code)}`, { headers: authHeader(token) })
}

// Both resolve with the player's state *after* the change ({ player, unlocks }), so the caller
// replaces what it holds rather than patching its own copy and hoping it matches.
export function grantUnlock(token, code, kind, asset) {
  return request(`/api/admin/players/${encodeURIComponent(code)}/unlocks`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ kind, asset })
  })
}

export function revokeUnlock(token, code, kind, asset) {
  const q = `kind=${encodeURIComponent(kind)}&asset=${encodeURIComponent(asset)}`
  return request(`/api/admin/players/${encodeURIComponent(code)}/unlocks?${q}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

// Hand-adjusting PTP. Resolves with the same { player, unlocks, points } shape as getPlayer,
// so the screen re-renders from the server's balance rather than adding the delta to its own.
//
// `reason` is required by the server on a deduction and ignored-if-blank on a grant.
export function adjustPoints(token, code, delta, reason) {
  return request(`/api/admin/players/${encodeURIComponent(code)}/points`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ delta, reason })
  })
}

export function uploadTournament(token, payload) {
  return request('/api/admin/tournaments', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export function listTournaments(token) {
  return request('/api/admin/tournaments', { headers: authHeader(token) })
}

export function getTournament(token, id) {
  return request(`/api/admin/tournaments/${encodeURIComponent(id)}`, { headers: authHeader(token) })
}

export function deleteTournament(token, id) {
  return request(`/api/admin/tournaments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

// After hand-editing the database (pgweb and friends), the cached stats on `players` are stale
// until something rebuilds them from the player_stats view. This is that something.
// One-time code that lets a player attach an account to an existing record, instead of
// registering fresh and ending up with a second identity holding none of their history.
export function mintClaimCode(token, code) {
  return request('/api/admin/claim-codes', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ code })
  })
}

// Move one player's whole record onto another and delete the source — for when the same
// person ended up with two codes. Resolves with a summary of what actually moved.
export function inheritRecords(token, code, from) {
  return request(`/api/admin/players/${encodeURIComponent(code)}/inherit`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ from })
  })
}

export function rebuildRecords(token) {
  return request('/api/admin/records/rebuild', { method: 'POST', headers: authHeader(token) })
}

export function listRewardPackages(token) {
  return request('/api/admin/reward-packages', { headers: authHeader(token) })
}

export function getRewardPackage(token, id) {
  return request(`/api/admin/reward-packages/${encodeURIComponent(id)}`, { headers: authHeader(token) })
}

export function saveRewardPackage(token, id, payload) {
  return request(`/api/admin/reward-packages/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export function deleteRewardPackage(token, id) {
  return request(`/api/admin/reward-packages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

// 秘笈手冊的方案階梯與每一冊的最低方案。整份讀、整份存 —— 編輯器上刪掉一列時沒有差異
// 可以送，只有每次重來才保證舊的一定不在（跟獎品組合同一種做法）。
export function getHandbookTiers(token) {
  return request('/api/admin/handbook/tiers', { headers: authHeader(token) })
}

export function saveHandbookTiers(token, payload) {
  return request('/api/admin/handbook/tiers', {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

// 當週免費試讀：某一冊在 `until`（含當天）之前對所有人開放，無視它原本要求的方案。
// 立刻生效、立刻存檔 —— 跟上面那組「整份存」不同，因為這是一個按鈕一次只改一冊，
// 而且它常常是臨時決定要開的，不該跟其他未存的修改綁在同一次送出。
export function setHandbookFree(token, unitId, until, note) {
  return request(`/api/admin/handbook/free/${encodeURIComponent(unitId)}`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ until, note })
  })
}

export function clearHandbookFree(token, unitId) {
  return request(`/api/admin/handbook/free/${encodeURIComponent(unitId)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

// 開通／調整一個玩家的訂閱。`expiresOn` 是 'YYYY-MM-DD'，空字串代表不過期。
// 兩支都回傳整份玩家狀態（跟 grantUnlock 一樣），畫面直接換掉手上那份，不自己拼。
export function setSubscription(token, code, tierKey, expiresOn, note) {
  return request(`/api/admin/players/${encodeURIComponent(code)}/subscription`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ tierKey, expiresOn, note })
  })
}

export function clearSubscription(token, code) {
  return request(`/api/admin/players/${encodeURIComponent(code)}/subscription`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

// 手冊的錢。訂單、到期名單、收入、對帳 —— 四支都是唯讀的，除了標記退款那一支。
export function listHandbookOrders(token, status) {
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  return request(`/api/admin/handbook/orders${q}`, { headers: authHeader(token) })
}

/**
 * 把一筆訂單標記為已退款。**這支不退錢** —— 錢是在綠界廠商後台退的，這裡只讓我們的
 * 帳跟著對上。`revoke` 是 'keep' | 'cut' | 'clear'，決定他的權限要不要跟著收回。
 */
export function refundHandbookOrder(token, merchantTradeNo, payload) {
  return request(`/api/admin/handbook/orders/${encodeURIComponent(merchantTradeNo)}/refund`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export function listHandbookSubscriptions(token, within, back) {
  return request(`/api/admin/handbook/subscriptions?within=${within}&back=${back}`, { headers: authHeader(token) })
}

export function getHandbookRevenue(token) {
  return request('/api/admin/handbook/revenue', { headers: authHeader(token) })
}

export function reconcileHandbook(token, begin, end) {
  return request(`/api/admin/handbook/reconcile?begin=${begin}&end=${end}`, { headers: authHeader(token) })
}

/* ── 折扣碼 ───────────────────────────────────────────────────────────────
   綠界沒有折扣碼這種東西（AIO 只收一個我們算好的金額），所以這整套是我們自己的帳。
   後台這幾支只負責「能怎麼用」；折了多少是開單當下寫死在訂單上的，改碼不會回頭影響
   已經成立的訂單。
*/

export function listHandbookCoupons(token) {
  return request('/api/admin/handbook/coupons', { headers: authHeader(token) })
}

/** 誰用過這張碼。訂單列表上看得到碼，這裡看得到一張碼的全部足跡。 */
export function listHandbookCouponUses(token, code) {
  return request(`/api/admin/handbook/coupons/${encodeURIComponent(code)}/uses`, { headers: authHeader(token) })
}

/** 新增或修改。整列覆蓋 —— 沒送的欄位就是沒有限制，不是沿用舊值。 */
export function saveHandbookCoupon(token, code, payload) {
  return request(`/api/admin/handbook/coupons/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

/** 只有從來沒被用過的碼刪得掉。用過的請改成停用 —— 那些訂單的折扣要查得到來源。 */
export function deleteHandbookCoupon(token, code) {
  return request(`/api/admin/handbook/coupons/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

/* ── 公告 ─────────────────────────────────────────────────────────────────
   未讀記在玩家的裝置上，伺服器只管「有哪些公告」。所以這幾支沒有任何「誰讀過」的
   概念 —— 那份資料從來不會離開那台瀏覽器。
*/

export function listAnnouncements(token) {
  return request('/api/admin/announcements', { headers: authHeader(token) })
}

/** 沒給 id 就是新的一則。改內文不會讓讀過的人重新看到——未讀是以 id 記的。 */
export function saveAnnouncement(token, payload) {
  return request('/api/admin/announcements', {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export function deleteAnnouncement(token, id) {
  return request(`/api/admin/announcements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

/* ── 跑馬燈 ──────────────────────────────────────────────────────────────── */

/** 全部的，包含停用與過期的。 */
export function listTicker(token) {
  return request('/api/admin/ticker', { headers: authHeader(token) })
}

/** 沒給 id 就是新的一條。 */
export function saveTicker(token, payload) {
  return request('/api/admin/ticker', {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export function deleteTicker(token, id) {
  return request(`/api/admin/ticker/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

/* ── 角色特性 ──────────────────────────────────────────────────────────────
   讀是公開的（見 characterTraits.js），只有寫在這裡。
*/

/** 整組覆蓋一隻角色的數值 —— 沒送的軸會被刪掉，不是沿用舊值。 */
export function saveCharacterTraits(token, characterId, traits) {
  return request('/api/admin/character-traits', {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ characterId, traits })
  })
}

/* ── 手冊：下架 ───────────────────────────────────────────────────────────
   下架中的冊子誰都讀不到，包含已經買到那一檔的人。書架上還看得到它，封面帶一條字。
*/

/** 下架一冊。`label` 是封面上那條字，空的話伺服器會用預設的「監修中」。 */
export function holdHandbookUnit(token, unitId, label, note) {
  return request(`/api/admin/handbook/hold/${encodeURIComponent(unitId)}`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ label, note })
  })
}

/** 重新上架。 */
export function releaseHandbookUnit(token, unitId) {
  return request(`/api/admin/handbook/hold/${encodeURIComponent(unitId)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

/** 開賣 / 停售整家書店。關著的時候非管理員連 manifest 都拿不到。 */
export function setHandbookShopOpen(token, open) {
  return request('/api/admin/handbook/shop', {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ open })
  })
}
