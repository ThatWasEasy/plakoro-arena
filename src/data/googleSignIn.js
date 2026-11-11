// Google Identity Services 的那顆按鈕。
//
// 走的是 ID token 這條路，不是授權碼交換：按鈕按下去，Google 直接給一張簽好的 JWT，
// 前端把它送給後端驗。前端是 GitHub Pages 上的靜態檔案，沒有伺服器可以接 redirect，
// 所以授權碼那條路本來就走不了 —— 這也是為什麼用戶端密鑰完全用不到。
//
// 用戶端 ID 編進 bundle 是正常的，它本來就是公開資訊（會出現在授權頁的網址上）。真正
// 擋住冒用的是後端對 aud 的比對，不是這個值藏不藏得住。

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const SRC = 'https://accounts.google.com/gsi/client'

/** 沒設用戶端 ID 就當作這個功能不存在，畫面上不會出現按鈕。 */
export const googleAvailable = Boolean(CLIENT_ID)

let loading = null

/**
 * 把 Google 的 script 載進來，成功後 resolve 出 `window.google.accounts.id`。
 *
 * 只載一次。失敗就一直是失敗 —— 不重試，因為會失敗的情境（擋廣告的擴充套件、公司網路
 * 擋 Google、離線）重試一百次也是同樣結果，而呼叫端要的只是「這顆按鈕畫不出來」。
 */
function loadScript() {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id)
    const el = document.createElement('script')
    el.src = SRC
    el.async = true
    el.onload = () => {
      const api = window.google?.accounts?.id
      api ? resolve(api) : reject(new Error('google identity services did not load'))
    }
    el.onerror = () => reject(new Error('google identity services did not load'))
    document.head.appendChild(el)
  })
  return loading
}

/**
 * 在 `el` 裡畫出 Google 的官方按鈕，按下去之後把拿到的 credential 交給 `onCredential`。
 *
 * 用官方的 renderButton 而不是自己做一顆：Google 的品牌規範要求按鈕的樣式、字體與
 * 標誌都照他們的來，自己畫的過不了審核。
 *
 * 回傳一個取消函式，元件卸載時呼叫 —— 不取消的話，離開畫面之後按鈕的 callback 還會對著
 * 已經不存在的元件跑。
 */
export async function renderGoogleButton(el, onCredential, { locale = 'zh-TW', width } = {}) {
  if (!googleAvailable) return () => {}
  let cancelled = false
  const api = await loadScript()
  if (cancelled) return () => {}

  api.initialize({
    client_id: CLIENT_ID,
    callback: response => {
      if (cancelled || !response?.credential) return
      onCredential(response.credential)
    },
    // 不要那個右上角自己跳出來的「使用 ... 繼續」—— 這個站的登入是玩家主動點進來的
    // 一件事，不是一進首頁就該被攔下來問的。
    auto_select: false,
    cancel_on_tap_outside: true
  })

  // 寬度要自己量。GIS 不吃百分比，沒給的話會畫成一個固定寬度的按鈕，在手機上跟旁邊
  // 撐滿的輸入框對不齊。上限是 Google 自己訂的 400。
  const px = width || Math.min(400, Math.round(el.clientWidth))
  api.renderButton(el, {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    // 我們的語系碼是 zh-TW，GIS 要的是 zh_TW。
    locale: String(locale).replace('-', '_'),
    ...(px > 0 ? { width: px } : {})
  })

  return () => {
    cancelled = true
    // 這一句讓 Google 忘掉上一次的 callback。不呼叫的話，下次在別的畫面 initialize
    // 之前的那一瞬間，舊的 callback 仍然是活的。
    try { api.cancel() } catch (e) { /* 還沒載完就離開，沒有東西要取消 */ }
  }
}
