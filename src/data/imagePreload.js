import { TYPE_BG_COLORS } from './constants'
import { asset } from './assetPath'
import { lowData } from './lowDataMode'

export const PRELOAD_IMAGE_PATHS = [
  asset("image/ICON/キャラコロ.png"),
  asset("image/ICON/エネコロ1.png"),
  asset("image/ICON/エネコロ2.png"),
  asset("image/ICON/エネコロ3.png"),
  asset("image/ICON/エネコロ4.png"),
  asset("image/ICON/エネコロ5.png"),
  asset("image/ICON/エネコロ6.png"),
  ...Object.keys(TYPE_BG_COLORS).map(t => asset(`image/BACK/back_${t}.png`))
]

const IMAGE_LOAD_CACHE_KEY = "plakoro_image_load_cache_v1"

function readImageLoadCache() {
  try {
    const raw = localStorage.getItem(IMAGE_LOAD_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch (e) {
    return {}
  }
}

function markImageLoaded(src) {
  try {
    const cache = readImageLoadCache()
    if (!cache[src]) {
      cache[src] = Date.now()
      localStorage.setItem(IMAGE_LOAD_CACHE_KEY, JSON.stringify(cache))
    }
  } catch (e) {}
}

function loadImageWithTimeout(src, timeoutMs) {
  return new Promise(resolve => {
    let settled = false
    const img = new Image()
    const finish = () => {
      if (settled) return
      settled = true
      resolve(img)
    }
    img.onload = () => {
      markImageLoaded(src)
      finish()
    }
    img.onerror = finish
    setTimeout(finish, timeoutMs)
    img.src = src
  })
}

export function preloadEssentialImages() {
  // 攔在這裡而不是 PRELOAD_IMAGE_PATHS：那個陣列在模組載入時就算好了，之後才開啟
  // 低流量模式的話它裡面還是真實網址。
  if (lowData.value) return Promise.resolve([])
  const cache = readImageLoadCache()
  const tasks = PRELOAD_IMAGE_PATHS.map(src => {
    const timeoutMs = cache[src] ? 1500 : 4000
    return loadImageWithTimeout(src, timeoutMs)
  })
  return Promise.all(tasks)
}

export function preloadCharacterImages(characters) {
  if (lowData.value) return Promise.resolve([])
  const cache = readImageLoadCache()
  const tasks = characters.filter(c => c.imageUrl).map(c => {
    const timeoutMs = cache[c.imageUrl] ? 1500 : 4000
    return loadImageWithTimeout(c.imageUrl, timeoutMs)
  })
  return Promise.all(tasks)
}
