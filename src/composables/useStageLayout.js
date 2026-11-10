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

export function useStageLayout(stageEl) {
  function layoutStage() {
    // 舞台就是視窗（見 style.css 的 #stage），所以這裡只剩一件事：決定 1rem 有多大。
    //
    // 橫的時候照舊，用 16:9 算出來的高度當基準 —— 既有的每一個 rem 值都是照那個比例
    // 調出來的，換基準等於重調整個 App。
    // 直的時候改用寬度：拿高度算的話，390×844 的手機會得到 9px 的 1rem，整個畫面縮成
    // 一條。直握是會發生的事，不是要被懲罰的事。
    const vw = window.innerWidth
    const vh = window.innerHeight
    const base = vh > vw ? vw : Math.min(vh, vw * 9 / 16)
    document.documentElement.style.fontSize = (ROOT_FONT_SIZE * base / DESIGN_WIDTH) + 'px'
  }

  onMounted(() => {
    layoutStage()
    window.addEventListener('resize', layoutStage)
    window.addEventListener('orientationchange', layoutStage)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', layoutStage)
    window.removeEventListener('orientationchange', layoutStage)
  })
}
