// Who is using this copy of the app.
//
// Nothing signs in yet — there is no account system, no server, no session. This exists so the
// screens that will care can already ask the question, and so the day accounts arrive the
// answer changes here rather than in every component that needed it.
//
// The shape deliberately matches a nameplate's identity fields, because that is what a signed-in
// player will be: a row in the same records the badges are drawn from.
import { ref, computed } from 'vue'
import { clearProgress } from './handbookProgress'
import { getToken, onSessionRejected, setToken } from './session'
import { clearGifts } from './gifts'
import { clearPoints } from './points'
import { forgetMine } from './handbookTiers'

const STORAGE_KEY = 'plakoro_current_player_v1'

// The face shown before anyone signs in. Not the generic fallback — this is the one the
// organiser's own entry uses, so the corner looks like somebody rather than like a blank.
const GUEST_AVATAR = 'safe-mascot'

// null means "nobody is signed in", which is the only state that exists today. It is kept as a
// ref rather than a constant so the chip re-renders the moment that stops being true.
const player = ref(load())

// 身分與憑證是同一次登入的兩半，要嘛都在、要嘛都不在。只剩一半的 localStorage 不構成一個
// 工作階段 —— 可能是使用者手動清掉了一邊，也可能是某個舊版本留下來的。
//
// 這段在模組載入時跑一次，所以帶著半套狀態的瀏覽器一打開新版就自己回到乾淨的訪客。對已經
// 散出去的版本來說，這是唯一不必等使用者做任何事就能收斂的地方。只是它治不了停在舊版不更新
// 的瀏覽器 —— 要連那些一起處理，得從伺服器端讓舊憑證失效。
if (!player.value) setToken(null)
if (!getToken()) setCurrentPlayer(null)

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && p.code ? p : null
  } catch (e) {
    return null
  }
}

export const currentPlayer = computed(() => player.value)
export const isSignedIn = computed(() => player.value !== null)

// What the corner shows. A guest gets the same shape as a player so the component has no
// branch of its own — the difference is in the data, not in the markup.
export const currentIdentity = computed(() => player.value || {
  code: null,
  name: null,
  avatar: GUEST_AVATAR
})

/**
 * Sign in as a known player. Nothing calls this yet.
 *
 * Whatever auth ends up being — a code the organiser issues, an email link, an OAuth
 * provider — it ends here, and everything downstream already reads from `currentPlayer`.
 */
export function setCurrentPlayer(p) {
  player.value = p && p.code ? p : null
  try {
    if (player.value) localStorage.setItem(STORAGE_KEY, JSON.stringify(player.value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    // A full or disabled store is not worth failing a sign-in over; the session just won't
    // survive a reload.
  }
}

export function signOut() {
  // 憑證先收，其餘的才是畫面。一個登出的人手上不該留著任何還能用的東西。
  setToken(null)
  setCurrentPlayer(null)
  // Whatever was in the corner belonged to whoever just left.
  clearGifts()
  clearPoints()
  // 訂閱屬於剛才那個人，不屬於這台裝置。
  forgetMine()
  // 讀到哪一頁也是。它現在存在伺服器上，這裡清的是畫面上還留著的那一份 —— 不清的話，
  // 下一個在這台裝置登入的人，書架上第一眼看到的是上一個人的「繼續閱讀」。
  clearProgress()
}

// A token the server refuses is a session that has ended, whatever ended it — so it goes
// through exactly the same teardown as pressing the sign-out button, rather than a second,
// slightly different idea of what being signed out means.
onSessionRejected(signOut)
