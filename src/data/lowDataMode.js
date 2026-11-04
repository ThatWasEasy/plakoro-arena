// 低流量模式：不下載任何圖片。
//
// 為什麼值得做：public/image 有 21MB，其中光是 image/BACK（招式卡的滿版底圖）就佔 16MB，
// 單張 1.5MB。在賽場的行動網路下，那是開一次 app 就吃掉的量。
//
// 做法是在 `asset()` 那一層把圖片路徑換成 1×1 透明 GIF 的 data URI，而不是用 CSS 把
// `<img>` 藏起來 —— 藏起來照樣會下載，省不到流量，而那正是這個模式唯一的目的。
// 換成 data URI 的另一個好處是版面不動：圖片變透明，尺寸、間距、對齊全部照舊，
// 不會出現破圖圖示，也不會因為元素消失而讓整頁重排。
import { ref, watch } from 'vue'

const KEY = 'plakoro_low_data_v1'

function load() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
  } catch (e) {
    return false
  }
}

export const lowData = ref(load())

export function setLowData(on) {
  lowData.value = Boolean(on)
  try {
    localStorage.setItem(KEY, lowData.value ? '1' : '0')
  } catch (e) {
    // 記不住只是下次要重開，不值得為它失敗。
  }
}

// 打在 <html> 上，給純 CSS 的背景圖用 —— 那些是 Vite 打包進來的，走不到 `asset()`。
// 有 document 才動。assetPath 會被 game/ 底下的模組一路 import 進來，而那些模組跑在
// 沒有 DOM 的測試環境裡 —— 在模組載入時直接碰 document 會讓整份測試掛在 import 階段。
function applyClass(on) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('low-data', on)
}
applyClass(lowData.value)
watch(lowData, applyClass)
