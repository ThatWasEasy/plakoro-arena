import { onMounted, onUnmounted, ref } from 'vue'

// The UI was designed against this logical width (a typical phone's portrait width) — root
// font-size scales so every `rem` value in the app tracks the stage's actual rendered size
// instead of staying fixed regardless of how large or small the stage ends up being.
const DESIGN_WIDTH = 375
const ROOT_FONT_SIZE = 16

/**
 * 舞台有沒有被轉過 90°。
 *
 * **永遠是 false。** 舞台不再自己把直的手機轉成橫的 —— 要不要橫著拿是玩家自己的決定，
 * 不是我們替他做的。留著這個旗標是因為指標事件的修正還讀它（見 DiceRoll3DCanvas.vue）：
 * 不轉了，修正就是個不做事的分支，但把它一起拆掉會動到骰子的拖曳判斷，那是另一件事。
 */
export const isStagePortrait = ref(false)

/**
 * 轉向之後要重算幾次。
 *
 * iOS 的 resize / orientationchange 會在尺寸還沒定下來之前就觸發，而且**不保證之後還會
 * 再給一次事件** —— 只算一次的話，整個 App 會固定在用舊尺寸算出來的比例上。所以旋轉後
 * 隔一段時間再補算，數字是經驗值：第一次抓轉場剛開始，最後一次抓轉場動畫結束之後。
 */
const SETTLE_DELAYS = [0, 120, 300, 600]

export function useStageLayout(stageEl) {
  let timers = []

  function layoutStage() {
    // 舞台就是視窗（見 style.css 的 #stage），所以這裡只剩一件事：決定 1rem 有多大。
    //
    // 橫的時候照舊，用 16:9 算出來的高度當基準 —— 既有的每一個 rem 值都是照那個比例
    // 調出來的，換基準等於重調整個 App。
    // 直的時候改用寬度：拿高度算的話，390×844 的手機會得到 9px 的 1rem，整個畫面縮成
    // 一條。直握是會發生的事，不是要被懲罰的事。
    //
    // 優先讀 visualViewport：旋轉之後 window.innerWidth/innerHeight 在 iOS 上會有一段
    // 時間還是舊值，而 visualViewport 反映的是真正畫得出來的那塊區域。沒有這個 API 的
    // 瀏覽器退回 window，行為跟以前一樣。
    const vp = window.visualViewport
    const vw = vp?.width || window.innerWidth
    const vh = vp?.height || window.innerHeight
    if (!vw || !vh) return
    const base = vh > vw ? vw : Math.min(vh, vw * 9 / 16)
    document.documentElement.style.fontSize = (ROOT_FONT_SIZE * base / DESIGN_WIDTH) + 'px'
  }

  /**
   * 逼 Safari 重新算一次 #stage 的位置。
   *
   * 整個 App 都裝在 `#stage { position: fixed; inset: 0 }` 裡面，而 iOS 有個長年的問題：
   * 旋轉之後 fixed 元素會用新的版面繪製，但**點擊的命中區域留在舊的座標系**，結果就是
   * 東西看得到、點不到，或是點到旁邊那一個。加到主畫面（standalone）的時候特別明顯。
   *
   * 把 position 暫時換成 absolute 再換回來，Safari 就會重新建立那個元素的位置。只動這
   * 一個元素是刻意的 —— 常見的做法是把整個 body `display:none` 再打開，那會連帶重載
   * Google 登入的 iframe、讓 3D 骰子的 canvas 收到一次 0×0，並且把手冊閱讀器的捲動位置
   * 清回頂端。
   *
   * body 的高度是 100%，所以 absolute 跟 fixed 蓋到的是同一塊，畫面不會跳。
   *
   * 沒效的話整支拿掉就好，不會留下任何依賴。
   */
  function nudgeStage() {
    const el = stageEl?.value
    if (!el) return
    el.style.position = 'absolute'
    // 讀一次版面屬性，強迫瀏覽器在這裡就重排，而不是等到這個函式跑完才一次算完 ——
    // 不讀的話兩次賦值會被合併，等於什麼都沒做。
    void el.offsetHeight
    el.style.position = ''
  }

  function settle() {
    timers.forEach(clearTimeout)
    timers = SETTLE_DELAYS.map(ms => setTimeout(() => {
      layoutStage()
      nudgeStage()
    }, ms))
  }

  onMounted(() => {
    layoutStage()
    window.addEventListener('resize', layoutStage)
    // 轉向要走補算那條路，不是只算一次。
    window.addEventListener('orientationchange', settle)
    window.visualViewport?.addEventListener('resize', layoutStage)
  })
  onUnmounted(() => {
    timers.forEach(clearTimeout)
    window.removeEventListener('resize', layoutStage)
    window.removeEventListener('orientationchange', settle)
    window.visualViewport?.removeEventListener('resize', layoutStage)
  })
}
