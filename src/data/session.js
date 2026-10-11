// The session token, kept separate from currentPlayer.js — that module's shape is deliberately
// a nameplate's identity fields (code/name/avatar/background), read by badges and banners that
// have no business touching a credential. A token lives here instead.
const TOKEN_KEY = 'plakoro_session_token_v1'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch (e) {
    return null
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch (e) {
    // Same stance as currentPlayer.js: a full or disabled store just means the session won't
    // survive a reload, not something worth failing sign-in over.
  }
}
