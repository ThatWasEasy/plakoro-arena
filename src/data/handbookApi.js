// 手冊的金流。其餘的手冊資料走 handbookSource.js，權限走 handbookTiers.js。
//
// 這裡只有兩支，因為前端在付款這件事上能做的只有兩件：請後端開一筆單，以及回來之後
// 問那筆單怎麼樣了。**開通與否從頭到尾不經過瀏覽器** —— 綠界是直接打後端的 ReturnURL，
// 使用者被導回來時付款可能都還沒處理完。
import { request } from './apiRequest'

/**
 * 開一筆訂單，拿回要 POST 給綠界的表單。
 *
 * 回傳 { merchantTradeNo, amount, months, planName, stage, action, fields }。
 * 金額由後端算 —— 前端送的只有「哪一檔、買多久」，送金額過去是把價格交給瀏覽器決定。
 */
export function createCheckout(token, tierKey, period, code) {
  return request('/api/ecpay/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tierKey, period, code })
  })
}

/**
 * 這一單折完多少 —— 只試算，不開單。
 *
 * 回 { listed, discount, amount, code, label }。折扣碼要在按下付款之前就看得到折了多少，
 * 而那個數字只能由伺服器算：金額一旦讓瀏覽器有機會決定，折扣碼就是一個任人填的價錢欄位。
 *
 * 試算的結果**不具效力**。真正收多少由 createCheckout 當下重算 —— 中間可能隔了十分鐘，
 * 碼可能剛被用完、剛被停用、或剛過期。
 */
export function quoteCheckout(token, tierKey, period, code) {
  return request('/api/handbook/quote', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tierKey, period, code })
  })
}

/** 查一筆自己的訂單。回 { order, mine }。 */
export function getOrder(token, merchantTradeNo) {
  return request(`/api/ecpay/orders/${encodeURIComponent(merchantTradeNo)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
}

/**
 * 把後端給的欄位做成一張表單送出去，整頁跳轉到綠界。
 *
 * 為什麼不是 fetch 或 302：綠界收的是 POST + form-urlencoded，302 帶不了 body，
 * fetch 拿回來的 HTML 也沒辦法變成使用者看得到的付款頁。
 *
 * ⚠️ 絕對不可以放進 iframe —— 綠界付款頁有 X-Frame-Options，會被整個擋掉，使用者
 * 看到的是一片空白。
 */
export function submitToGateway({ action, fields }) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = action
  form.style.display = 'none'
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = String(value)
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

/**
 * 這個瀏覽器是不是 App 內嵌的。
 *
 * LINE 跟 Facebook 的內嵌瀏覽器會攔截綠界付款頁的導向，結果是付款失敗或卡在空白頁 ——
 * 而且**沒有任何錯誤訊息**，使用者只會覺得「你們的網站壞了」。對我們來說這不是邊緣
 * 情況：宣傳都發在 FB 社團，從貼文點進來的人預設就在 FB 的內嵌瀏覽器裡。
 *
 * 偵測得到就在按下付款之前先講，而不是讓他按下去才卡住。
 */
export function inAppBrowser() {
  const ua = navigator.userAgent || ''
  if (/\bLine\//i.test(ua)) return 'LINE'
  if (/\bFBAN\/|\bFBAV\/|\bFB_IAB\//.test(ua)) return 'Facebook'
  if (/\bInstagram\b/i.test(ua)) return 'Instagram'
  return null
}

/**
 * 這個人每一冊讀到哪裡。回 { progress: { unitId: { page, pages, at } } }。
 *
 * 進度跟著帳號，不跟著裝置 —— 換手機要接得上，而同一台手機換人登入時，前一個人的
 * 書籤不該還在書架上。
 */
export function listHandbookProgress(token) {
  return request('/api/handbook/progress', { headers: { Authorization: `Bearer ${token}` } })
}

/** 記下一冊讀到哪一頁。一冊只有一個位置，寫進去就蓋掉上一個。 */
export function saveHandbookProgress(token, unitId, page, pages) {
  return request(`/api/handbook/progress/${encodeURIComponent(unitId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ page, pages })
  })
}
