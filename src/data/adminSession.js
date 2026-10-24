// Admin mode: who may turn it on, and whether it is on right now.
//
// There is no separate admin credential any more. The organiser signs in as an ordinary player
// whose code happens to be the reserved one, and admin-only screens read that same session —
// one login, one token, one thing to get wrong instead of two.
//
// P000000 is safe as a sentinel because `nextPlayerCode()` numbers from MAX(code) + 1 starting
// at 1, so registration can never hand it out. It has to be inserted deliberately.
import { computed, ref } from 'vue'
import { currentIdentity } from './currentPlayer'
import { getToken } from './session'

export const ADMIN_PLAYER_CODE = 'P000000'

// Whether this account is *allowed* to turn admin mode on — which is also the only thing that
// decides whether the checkbox exists at all. Everyone else never learns it's there.
export const isAdminAccount = computed(() => currentIdentity.value.code === ADMIN_PLAYER_CODE)

// Off on every page load, deliberately. Being the organiser is permanent; wanting the admin
// cards in the menu is not, and most of the time they're just clutter over the actual game.
const enabled = ref(false)

export const isAdminMode = computed(() => isAdminAccount.value && enabled.value)

export function setAdminMode(on) {
  enabled.value = Boolean(on)
}

// What the admin screens send as their bearer token: the player's own. Null unless admin mode
// is actually on, so a component that forgets to check `isAdminMode` fails closed rather than
// quietly working.
//
// The server makes the same check independently (see requireAdminSession) — this one only
// decides what gets sent, never what gets allowed.
export const adminToken = computed(() => (isAdminMode.value ? getToken() : null))
