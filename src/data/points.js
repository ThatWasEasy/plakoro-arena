// The PTP balance, shared between the corner of the main screen and the profile that opens
// from it — same reasoning as gifts.js: two screens have to agree the moment a gift is opened,
// and threading a ref through App.vue to manage that would make the menu responsible for a
// screen it doesn't render.
import { ref } from 'vue'
import * as authApi from './authApi'
import { getToken } from './session'

export const ptpBalance = ref(0)

/**
 * Re-read the balance. Silent on failure, like the gift badge: a number that briefly says 0 on
 * a bad connection is better than an error sitting in the corner of the home screen, and the
 * next load corrects it.
 */
export async function refreshPoints() {
  const token = getToken()
  if (!token) { ptpBalance.value = 0; return }
  try {
    const { balance } = await authApi.listPoints(token)
    ptpBalance.value = balance || 0
  } catch (e) {
    ptpBalance.value = 0
  }
}

/**
 * Take the balance the server just handed back, rather than asking again for a number it
 * already told us. Opening a gift is the one moment this changes without anyone reloading.
 */
export function setPtpBalance(n) {
  if (Number.isFinite(n)) ptpBalance.value = n
}

export function clearPoints() {
  ptpBalance.value = 0
}
