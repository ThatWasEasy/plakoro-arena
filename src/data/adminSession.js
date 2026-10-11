// The admin-mode session token, kept entirely separate from session.js (a player's own token).
// This one never identifies a player — it only ever proves "this browser passed the admin PIN
// check" — so nothing that reads a player's session should ever go near it.
//
// Deliberately in-memory only, not localStorage: a player's login should survive a reload, but
// admin mode is the opposite — it should require the PIN again every time the page loads, not
// stay unlocked indefinitely just because it was entered once.
import { computed, ref } from 'vue'

export const adminToken = ref(null)

// Whether this browser is in admin mode right now — what the "切換身份" entry in the tools
// menu checks before showing itself.
export const isAdminMode = computed(() => adminToken.value !== null)

export function setAdminToken(token) {
  adminToken.value = token
}
