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
 * 轉向之後隔多久才去修。
 *
 * 要等 iOS 的旋轉動畫跑完 —— 太早做的話，量到的還是轉之前的狀態，等於白做。
 *
 * 這裡的歷史值得留著：先前試過「排在 0/120/300/600ms 各做一次」，以及「用 rAF 每一幀
 * 盯尺寸有沒有變」，兩種都實測無效。真機診斷量到的是，轉成橫向之後
 * visualViewport.offsetTop = -62、`#stage`（inset:0）被畫在 y=62，而且那時候尺寸早就
 * 不再變動了 —— 問題從來不是「量得不夠勤」。
 */
const SETTLE_MS = 300

export function useStageLayout() {
  let timer = 0

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
   * 捲一格再捲回來，逼 WebKit 重新對齊座標。
   *
   * 針對的是真機量到的那 62px：橫向時版面視窗比視覺視窗矮一截（那正好是 Safari 工具列
   * 的高度），而 `position: fixed` 是釘在**版面視窗**上的，所以整個 #stage 跟著被推下去，
   * 要好幾秒才會自己對齊。
   *
   * html/body 是 overflow:hidden，看起來沒有東西可以捲 —— 但被錯開的正是版面視窗，而
   * scrollTo 動的就是它。先到 1 再回 0，是因為捲到同一個位置不會觸發任何重算。
   */
  function realign() {
    window.scrollTo(0, 1)
    window.scrollTo(0, 0)
    layoutStage()
  }

  function onOrientation() {
    clearTimeout(timer)
    layoutStage()
    timer = setTimeout(realign, SETTLE_MS)
  }

  onMounted(() => {
    layoutStage()
    window.addEventListener('resize', layoutStage)
    window.addEventListener('orientationchange', onOrientation)
    window.visualViewport?.addEventListener('resize', layoutStage)
  })
  onUnmounted(() => {
    clearTimeout(timer)
    window.removeEventListener('resize', layoutStage)
    window.removeEventListener('orientationchange', onOrientation)
    window.visualViewport?.removeEventListener('resize', layoutStage)
  })
}
