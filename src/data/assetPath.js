// The app can be deployed under a sub-path (not the domain root), so any asset path
// built at runtime (template strings, string concatenation) must be resolved against
// Vite's configured `base` instead of assumed to be root-relative. Static references
// that Vite can see at build time (CSS url(), index.html tags, statically-analyzable
// `:src="'/foo.png'"` literals) are already rewritten automatically by Vite's `base`
// handling and don't need this — this is only for paths assembled dynamically in JS.
//
// 這裡也是低流量模式唯一的攔截點：所有在 JS 裡組出來的圖片路徑都經過這個函式，
// 在這一層換掉就不會發出請求（用 CSS 藏起來照樣會下載，省不到流量）。
import { lowData } from './lowDataMode'

// 1×1 全透明 GIF。回空字串或 about:blank 會讓 <img> 變成破圖圖示，回它才是「看不見但
// 還在那裡」—— 版面不動，也不會有錯誤圖示。
const BLANK_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
// 只攔圖片。音檔也走這個函式（music/*.mp3），一起攔掉會讓背景音樂無聲地壞掉。
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i

/**
 * @param {string} path
 * @param {{ raw?: boolean }} [options] `raw` 繞過低流量模式。只給「這張圖就是功能本身」
 *   的地方用 —— 目前只有 3D 骰子的面（見 game/diceTextures.js）：少了符號的骰子不是
 *   低流量畫面，是一顆看不懂的骰子。
 */
export function asset(path, { raw = false } = {}) {
  if (!raw && lowData.value && IMAGE_EXT.test(path)) return BLANK_PIXEL
  const base = import.meta.env.BASE_URL || '/'
  const normalizedBase = base.endsWith('/') ? base : base + '/'
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return normalizedBase + normalizedPath
}

/**
 * 同一個開關，給「已經是網址」的圖片用 —— Vite 打包進來的那些（`import logo from
 * '../assets/logo.png'`、`import.meta.glob`）不經過 asset()，但一樣是要下載的位元組。
 * 光是桌面材質 3.6MB、頭像 1.9MB、旗幟 1.3MB，漏掉它們等於這個模式只做了一半。
 */
export function bundled(url) {
  return lowData.value && url ? BLANK_PIXEL : url
}
