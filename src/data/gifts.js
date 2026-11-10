// The unopened-gift count, shared between the badge on the main screen and the reveal that
// opens from it.
//
// Module state rather than a prop chain: the badge lives in the menu and the reveal is a
// separate screen, and both have to agree the instant the last card is turned over. Threading
// a ref through App.vue to do that would make the menu responsible for a screen it doesn't
// render.
import { computed, ref } from 'vue'
import * as authApi from './authApi'
import { setPtpBalance } from './points'
import { getToken } from './session'

const gifts = ref([])
// 已經拆開的那幾封。信箱留著它們 —— 一封信被拆開之後不會消失，它只是不能再拆一次。
const claimed = ref([])

export const giftCount = computed(() => gifts.value.length)
export const hasGifts = computed(() => gifts.value.length > 0)
export const pendingGifts = computed(() => gifts.value)
export const claimedGifts = computed(() => claimed.value)

/**
 * Re-read what's waiting. Silent on failure: the badge is an invitation, and a player offline
 * for a moment should see no badge rather than an error on the main menu.
 */
export async function refreshGifts() {
  const token = getToken()
  if (!token) { gifts.value = []; claimed.value = []; return }
  try {
    const { gifts: list, history } = await authApi.listGifts(token)
    gifts.value = list || []
    claimed.value = history || []
  } catch (e) {
    gifts.value = []
    claimed.value = []
  }
}

/**
 * 領一件，拿回那一件。
 *
 * 只把那一列從手上這份清單拿掉 —— 不重抓整份：信箱正開著，整份換掉會讓左邊那一列
 * 在使用者眼前重排一次。
 */
export async function claimOneGift(id) {
  const token = getToken()
  if (!token) return null
  const res = await authApi.claimGift(token, id)
  const got = res.claimed?.[0] || null
  // 從「待領」搬到「已領」，不是刪掉 —— 信箱正開著，那一列要留在原地變成已拆的狀態。
  gifts.value = gifts.value.filter(g => g.id !== id)
  if (got) claimed.value = [{ ...got, claimed_at: new Date().toISOString() }, ...claimed.value]
  setPtpBalance(res.balance)
  return got
}

/**
 * Open everything. Resolves with the opened items for the reveal to walk through, or throws —
 * here the caller does want to know, because a failed claim with an emptied badge would look
 * like the prizes vanished.
 */
export async function claimAllGifts() {
  const token = getToken()
  if (!token) return []
  const { claimed: got, balance } = await authApi.claimGifts(token)
  const at = new Date().toISOString()
  claimed.value = [...(got || []).map(g => ({ ...g, claimed_at: at })), ...claimed.value]
  gifts.value = []
  // Opening a points card is the moment it becomes spendable, and the corner of the main
  // screen is already showing the old number. The server just said what the new one is, so
  // there is nothing to go and ask.
  setPtpBalance(balance)
  return got || []
}

export function clearGifts() {
  gifts.value = []
  // 已拆的那幾封也是上一個人的信，一起收走。
  claimed.value = []
}
