// 公告，以及這台裝置讀過哪些。
//
// 「讀過」記在裝置上而不是帳號上 —— 那是需求，也剛好是對的：公告不需要登入就看得到，
// 而最需要被看到的那一則（維護、改價、活動）常常正是對著還沒登入的人發的。
//
// 記錄的內容是公告的 id。所以 id 必須穩定、而且永遠不能被重複使用：伺服器端用的是
// SERIAL，發出去的號碼不會再發第二次。換成任何「由人填編號」的來源（試算表那一類）
// 之前，先想清楚有人重排、重填、或把舊的那列改寫成新公告會發生什麼事 —— 整批裝置會
// 把新公告當成已經讀過的，而且沒有任何人會收到錯誤。
import { computed, ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_URL || ''

// 讀過哪些。鍵是信箱裡那一列的 id（公告是 'a3'、禮物是 'gu12'）—— 一個信箱裡的東西
// 不只公告，用一份紀錄記完，「讀過沒」在每一種信件上才是同一個意思。
const READ_KEY = 'plakoro_announce_read_v1'
// 「今日不再顯示」。id → 被按掉的那一天，隔天自己失效。
const SPLASH_KEY = 'plakoro_announce_splash_v1'

const list = ref([])
// 舊版只記公告，存的是純數字。遇到就地升級成 'a<id>'，不然所有讀過的公告會在改版後
// 一次全部亮回未讀。
const readIds = ref(load(READ_KEY, []).map(k => (typeof k === 'number' ? `a${k}` : k)))
const splashOff = ref(load(SPLASH_KEY, {}))

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    // 存不進去（無痕、空間滿了）就只是這台裝置記不住讀過什麼。公告照樣看得到，
    // 紅點會一直在 —— 比起讓畫面壞掉，那是便宜太多的失敗。
  }
}

// 「今天」照看的人所在地的日曆算，不是 UTC。toISOString 在台灣（UTC+8）會在早上八點
// 換日 —— 半夜按掉「今日不再顯示」的那則，同一天早上就又跳回來了。
function today() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 蓋板看完就算讀過，鍵要跟信箱那一列對得上。 */
export const noticeKey = id => `a${id}`

export const announcements = computed(() => list.value)
export const unreadIds = computed(() => list.value.filter(a => !isRead(`a${a.id}`)).map(a => a.id))
export const unreadCount = computed(() => unreadIds.value.length)
export const hasUnread = computed(() => unreadCount.value > 0)

/** 這一列讀過沒。`key` 是信箱列的 id，不是公告編號。 */
export const isRead = key => readIds.value.includes(key)

/**
 * 去拿公告。失敗就當作沒有公告。
 *
 * 跟禮物的 badge 同一種態度：公告是一個邀請，而不是這個 App 的必要條件。拿不到的時候
 * 該看到的是一個沒有紅點的主畫面，不是一個錯誤。
 */
export async function refreshAnnouncements() {
  try {
    const res = await fetch(`${API_BASE}/api/announcements`)
    if (!res.ok) throw new Error(String(res.status))
    const d = await res.json()
    list.value = d.announcements || []
  } catch (e) {
    list.value = []
  }
}

export function markRead(key) {
  if (!key || readIds.value.includes(key)) return
  readIds.value = [...readIds.value, key]
  save(READ_KEY, readIds.value)
}

/** 一次記下一整批。信箱關起來時把看得到的全部收乾淨。 */
export function markAllRead(keys = []) {
  const next = [...new Set([...readIds.value, ...keys.filter(Boolean)])]
  if (next.length === readIds.value.length) return
  readIds.value = next
  save(READ_KEY, readIds.value)
}

/**
 * 該蓋板的那幾則，照公告列表的順序（置頂在前、新的在前）。
 *
 * 全部都要，不是只取最新的一則：設成蓋板就是「這則一定要被看到」，少跳的那幾則等於
 * 後台按了卻沒有發生任何事。一則一則接著跳，每則都要自己按掉。
 *
 * 這也是為什麼蓋板要省著用 —— 同時掛三則，玩家進站就得連按三次才碰得到主畫面。
 */
export const splashNotices = computed(() =>
  list.value.filter(a => a.splash && splashOff.value[a.id] !== today()))

/** 今日不再顯示。只壓這一則、只壓今天 —— 明天又是新的一天，公告也可能已經換了。 */
export function hideSplashToday(id) {
  splashOff.value = { ...splashOff.value, [id]: today() }
  save(SPLASH_KEY, splashOff.value)
}
