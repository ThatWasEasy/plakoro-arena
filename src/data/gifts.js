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

export const giftCount = computed(() => gifts.value.length)
export const hasGifts = computed(() => gifts.value.length > 0)
export const pendingGifts = computed(() => gifts.value)

/**
 * Re-read what's waiting. Silent on failure: the badge is an invitation, and a player offline
 * for a moment should see no badge rather than an error on the main menu.
 */
export async function refreshGifts() {
  const token = getToken()
  if (!token) { gifts.value = []; return }
  try {
    const { gifts: list } = await authApi.listGifts(token)
    gifts.value = list || []
  } catch (e) {
    gifts.value = []
  }
}

/**
 * Open everything. Resolves with the opened items for the reveal to walk through, or throws —
 * here the caller does want to know, because a failed claim with an emptied badge would look
 * like the prizes vanished.
 */
export async function claimAllGifts() {
  const token = getToken()
  if (!token) return []
  const { claimed, balance } = await authApi.claimGifts(token)
  gifts.value = []
  // Opening a points card is the moment it becomes spendable, and the corner of the main
  // screen is already showing the old number. The server just said what the new one is, so
  // there is nothing to go and ask.
  setPtpBalance(balance)
  return claimed || []
}

export function clearGifts() {
  gifts.value = []
}
