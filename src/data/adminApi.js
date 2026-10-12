// Thin wrapper around the admin-mode endpoints in server/index.mjs, the same shape as
// authApi.js — every function resolves with the parsed JSON body or throws an Error whose
// message is the server's own `error` string.
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

function authHeader(token) {
  return { Authorization: `Bearer ${token}` }
}

export function searchPlayers(token, q) {
  return request(`/api/admin/players?q=${encodeURIComponent(q || '')}`, { headers: authHeader(token) })
}

export function getPlayer(token, code) {
  return request(`/api/admin/players/${encodeURIComponent(code)}`, { headers: authHeader(token) })
}

// Both resolve with the player's state *after* the change ({ player, unlocks }), so the caller
// replaces what it holds rather than patching its own copy and hoping it matches.
export function grantUnlock(token, code, kind, asset) {
  return request(`/api/admin/players/${encodeURIComponent(code)}/unlocks`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ kind, asset })
  })
}

export function revokeUnlock(token, code, kind, asset) {
  const q = `kind=${encodeURIComponent(kind)}&asset=${encodeURIComponent(asset)}`
  return request(`/api/admin/players/${encodeURIComponent(code)}/unlocks?${q}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

export function uploadTournament(token, payload) {
  return request('/api/admin/tournaments', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export function listTournaments(token) {
  return request('/api/admin/tournaments', { headers: authHeader(token) })
}

export function getTournament(token, id) {
  return request(`/api/admin/tournaments/${encodeURIComponent(id)}`, { headers: authHeader(token) })
}

export function deleteTournament(token, id) {
  return request(`/api/admin/tournaments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}

// After hand-editing the database (pgweb and friends), the cached stats on `players` are stale
// until something rebuilds them from the player_stats view. This is that something.
export function rebuildRecords(token) {
  return request('/api/admin/records/rebuild', { method: 'POST', headers: authHeader(token) })
}

export function listRewardPackages(token) {
  return request('/api/admin/reward-packages', { headers: authHeader(token) })
}

export function getRewardPackage(token, id) {
  return request(`/api/admin/reward-packages/${encodeURIComponent(id)}`, { headers: authHeader(token) })
}

export function saveRewardPackage(token, id, payload) {
  return request(`/api/admin/reward-packages/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  })
}

export function deleteRewardPackage(token, id) {
  return request(`/api/admin/reward-packages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeader(token)
  })
}
