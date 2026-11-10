// How far through each chapter the reader got.
//
// 登入的人記在帳號上（伺服器的 handbook_progress），沒登入的人記在這台裝置上。
//
// 一開始整份都記在 localStorage，那有兩個問題，第二個比第一個嚴重：換一台裝置就從頭
// 找起（訂閱跟著帳號走，進度卻不是），以及同一台裝置換一個人登入，書架上的「繼續閱讀」
// 還是前一個人的 —— 那是另一個人讀到哪裡的紀錄，不該留在這台裝置上，更不該出現在別人
// 的畫面上。所以登出會把它清乾淨（見 currentPlayer.js 的 signOut）。
//
// 沒登入的人只讀得到免費公開的那幾冊，沒有帳號可以掛，那份進度留在瀏覽器就好 —— 它不
// 屬於任何人，也沒有任何東西會因為它外洩。
//
// A 190-page book split across 27 chapters is unusable without this — "continue where I left
// off" is the difference between a shelf and a pile.
import { ref } from 'vue'
import { getToken } from './session'
import { listHandbookProgress, saveHandbookProgress } from './handbookApi'

// 訪客用的那一份。鍵名跟登入前後無關，裡面也永遠只會有免費冊子的位置。
const GUEST_KEY = 'plakoro_handbook_progress_guest_v1'
// 舊版把所有人的進度都存在這裡，不分帳號。留著只會讓下一個登入的人看到上一個人的書籤，
// 所以載入時就地刪掉 —— 不是停用，是清掉。
const LEGACY_KEY = 'plakoro_handbook_progress_v1'

function loadGuest() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_KEY))
    return raw && typeof raw === 'object' ? raw : {}
  } catch (e) {
    return {}
  }
}

function saveGuest(map) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(map))
  } catch (e) {
    // A reading position that does not survive a reload is not worth failing over.
  }
}

// One ref for the whole map, so the shelf re-renders the moment the reader closes.
const state = ref({})

export const progress = state

/**
 * 拿這個人的進度。登入就跟伺服器要，沒登入就讀這台裝置自己那一份。
 *
 * 書架一打開就呼叫。拿不到就當作沒有進度 —— 少一顆「繼續閱讀」的按鈕，比一個打不開的
 * 書架好太多。
 */
export async function refreshProgress() {
  // 舊版留下來的那一份，不管是誰的，看到就刪。
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch (e) {
    // 刪不掉（無痕、空間問題）就算了，下面不會去讀它。
  }
  const token = getToken()
  if (!token) {
    state.value = loadGuest()
    return
  }
  try {
    state.value = (await listHandbookProgress(token)).progress || {}
  } catch (e) {
    state.value = {}
  }
}

/** 登出時把上一個人的書籤收走。留在畫面上或留在這台裝置上都不行。 */
export function clearProgress() {
  state.value = {}
}

/** The page last seen in `unitId`, 1-based; 0 when it has never been opened. */
export function pageOf(unitId) {
  return state.value[unitId]?.page || 0
}

/** Whether a chapter has been opened at all — what separates "yours" from "started". */
export function startedOf(unitId) {
  return !!state.value[unitId]
}

/**
 * Remember where the reader is.
 *
 * `at` is the timestamp rather than a counter so "most recent" survives a chapter being
 * reopened and closed again without advancing.
 *
 * 畫面先更新，伺服器後寫：書籤寫失敗不該讓翻頁卡住，而下一次翻頁會再送一次同一件事。
 */
export function setProgress(unitId, page, pages) {
  if (!unitId || !page) return
  state.value = { ...state.value, [unitId]: { page, pages, at: Date.now() } }
  const token = getToken()
  if (!token) {
    saveGuest(state.value)
    return
  }
  saveHandbookProgress(token, unitId, page, pages).catch(() => {})
}

/** The chapter to offer as "continue reading", or null when nothing has been opened. */
export function mostRecent(units) {
  let best = null
  for (const u of units) {
    const p = state.value[u.id]
    if (!p) continue
    if (!best || p.at > best.at) best = { ...p, unit: u }
  }
  return best
}
