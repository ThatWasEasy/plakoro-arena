// Who is using this copy of the app.
//
// Nothing signs in yet — there is no account system, no server, no session. This exists so the
// screens that will care can already ask the question, and so the day accounts arrive the
// answer changes here rather than in every component that needed it.
//
// The shape deliberately matches a nameplate's identity fields, because that is what a signed-in
// player will be: a row in the same records the badges are drawn from.
import { ref, computed } from 'vue'
import { clearGifts } from './gifts'
import { clearPoints } from './points'

const STORAGE_KEY = 'plakoro_current_player_v1'

// The face shown before anyone signs in. Not the generic fallback — this is the one the
// organiser's own entry uses, so the corner looks like somebody rather than like a blank.
const GUEST_AVATAR = 'safe-mascot'

// null means "nobody is signed in", which is the only state that exists today. It is kept as a
// ref rather than a constant so the chip re-renders the moment that stops being true.
const player = ref(load())

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
  setCurrentPlayer(null)
  // Whatever was in the corner belonged to whoever just left.
  clearGifts()
  clearPoints()
}
