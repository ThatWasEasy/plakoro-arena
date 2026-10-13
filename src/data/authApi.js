// Thin wrapper around the login/registration endpoints in server/index.mjs. Every function
// resolves with the parsed JSON body or throws an Error whose message is the server's own
// `error` string — the UI just needs something to show, not a status code to branch on.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787'

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`)
  return data
}

// A brand new player — no history to protect, so no claim code needed. `account` is the login
// handle (unique, picked here); `name` is just the display nickname (not unique, shown on
// banners) — kept separate, see server/index.mjs.
export function register(account, name, pin) {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify({ account, name, pin }) })
}

// An existing numbered player linking an account for the first time (or resetting a forgotten
// PIN/account handle) with a one-time code the organiser issued — the code itself already says
// which player, so nothing else is needed to identify them, just the new account handle to log
// in with from now on.
export function claim(account, claimCode, pin) {
  return request('/api/auth/claim', { method: 'POST', body: JSON.stringify({ account, claimCode, pin }) })
}

export function login(account, pin) {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account, pin }) })
}

export function me(token) {
  return request('/api/players/me', { headers: { Authorization: `Bearer ${token}` } })
}

// Only the fields present in `patch` are changed — see server/index.mjs's own validation for
// what's actually allowed through (a name is free; an avatar/background/title has to be owned).
export function updateMe(token, patch) {
  return request('/api/players/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch)
  })
}

// This player's PTP: the balance and every line behind it. One call rather than two — the
// profile screen shows the number and the statement together.
export function listPoints(token) {
  return request('/api/players/me/points', { headers: { Authorization: `Bearer ${token}` } })
}

// Rewards this player has been given but not yet opened. Asked on every main-screen load, so
// the gift badge reflects a grant made while they were away rather than only after a reload.
export function listGifts(token) {
  return request('/api/players/me/gifts', { headers: { Authorization: `Bearer ${token}` } })
}

// Opens all of them in one call and answers with what was opened — the reveal walks that list
// one card at a time. All at once rather than per item so closing the screen midway cannot
// leave half a pile waiting.
export function claimGifts(token) {
  return request('/api/players/me/gifts/claim', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
}
