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

export function login(pin) {
  return request('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin }) })
}

export function searchPlayers(token, q) {
  return request(`/api/admin/players?q=${encodeURIComponent(q || '')}`, { headers: authHeader(token) })
}

export function getPlayer(token, code) {
  return request(`/api/admin/players/${encodeURIComponent(code)}`, { headers: authHeader(token) })
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
