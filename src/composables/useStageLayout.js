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
 * 轉向之後要盯多久，以及「不再變動」要安靜多久才算數。
 *
 * 不用固定的時間點去猜，是因為實測回報的症狀是「轉成橫向後壞掉，過 1~5 秒自己好」——
 * 那個「自己好」就是 iOS 終於把視窗尺寸報對的時刻，而它什麼時候來無法預測（排到
 * 600ms 就停的版本沒有用）。改成每一幀去看尺寸有沒有變，變了就立刻重排。
 *
 * 上限 6 秒：比回報的最長 5 秒再多一點。真的超過就放手，總比留一個永遠在跑的迴圈好。
 */
const WATCH_MS = 6000
const QUIET_MS = 500

export function useStageLayout(stageEl) {
  let watching = 0

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

  /**
   * 這一刻量到的尺寸長什麼樣。
   *
   * 四個來源都放進去是刻意的：旋轉過程中它們會彼此不一致（innerWidth 已經換了、
   * visualViewport 還沒，或者反過來），而那個不一致本身就是「還沒定下來」的訊號。
   */
  function signature() {
    const vp = window.visualViewport
    return [
      window.innerWidth, window.innerHeight,
      Math.round(vp?.width || 0), Math.round(vp?.height || 0),
      document.documentElement.clientWidth, document.documentElement.clientHeight
    ].join('x')
  }

  /**
   * 轉向之後盯著尺寸，變一次就重排一次，安靜夠久就收工。
   *
   * 關鍵在「變了就立刻做」而不是「時間到了才做」：iOS 把尺寸報對的那一刻，就是畫面
   * 真正該重算的那一刻，早一幀晚一幀都是玩家點不到東西的時間。
   */
  function settle() {
    cancelAnimationFrame(watching)
    const started = performance.now()
    let last = signature()
    let lastChange = started

    // 先做一次。事件剛來的時候尺寸可能已經是對的（Android 多半如此），那就不必等。
    layoutStage()
    nudgeStage()

    const tick = now => {
      const sig = signature()
      if (sig !== last) {
        last = sig
        lastChange = now
        layoutStage()
        nudgeStage()
      }
      // 安靜夠久、或盯太久了就停。停之前再做最後一次，確保收工時的狀態是對的。
      if (now - lastChange > QUIET_MS || now - started > WATCH_MS) {
        layoutStage()
        nudgeStage()
        return
      }
      watching = requestAnimationFrame(tick)
    }
    watching = requestAnimationFrame(tick)
  }

  onMounted(() => {
    layoutStage()
    // 三個都走 settle：iOS 上哪一個會先來、會不會來，三者都不保證。settle 自己會判斷
    // 尺寸有沒有真的變，所以重複觸發不會多做事。
    window.addEventListener('resize', settle)
    window.addEventListener('orientationchange', settle)
    window.visualViewport?.addEventListener('resize', settle)
  })
  onUnmounted(() => {
    cancelAnimationFrame(watching)
    window.removeEventListener('resize', settle)
    window.removeEventListener('orientationchange', settle)
    window.visualViewport?.removeEventListener('resize', settle)
  })
}
