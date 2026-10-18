// The standings board, read from the server every time it is opened.
//
// Not cached and not derived from anything local: a ranking is only worth looking at if it is
// current, and the numbers behind it live in matches nobody's browser has a copy of.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787'

/**
 * @param {'offline'|'online'} scope
 * @param {'year'|'all'} window
 * @param {string|null} code  the viewer's own code, so the server can send back their rank even
 *                            when they are past the hundred rows it returns. Optional: the board
 *                            is public and readable while signed out.
 */
export async function fetchLeaderboard(scope = 'offline', window = 'all', code = null) {
  const q = new URLSearchParams({ scope, window })
  if (code) q.set('code', code)
  const res = await fetch(`${API_BASE}/api/leaderboard?${q}`)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`)
  return data
}
