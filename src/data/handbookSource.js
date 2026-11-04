// Where the handbook's bytes come from.
//
// Never from this repo. It is public, and `dist/` is served as static files, so a chapter
// committed here is a chapter given away — the book is sold per chapter. In production the
// files live in the private API repo and arrive through `GET /api/handbook/:unit`, which
// answers 404 unless the caller's `player_unlocks` row exists.
//
// For now that endpoint does not exist yet, so the prototype reads from the local split
// output (`npm run split-handbook`, then serve handbook-build/pdf). Swapping one base URL is
// the whole difference between the two, which is the point of keeping it in one module.
import { getToken } from './session'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Set VITE_HANDBOOK_API=1 once the endpoint is live to go through the real, gated route.
// Until then the same paths are served by the dev proxy in vite.config.js, so the client code
// does not change when the server catches up — only where the proxy points.
const useApi = import.meta.env.VITE_HANDBOOK_API === '1'

export const isPrototype = !useApi

/**
 * Which book to show. The paid handbook and the free sample are the same shape — a manifest
 * and a set of chapter PDFs — so they are one code path and two catalogues, not two screens.
 * The sample is simply a shorter book.
 */
export const CATALOGUE = { HANDBOOK: 'handbook', PREVIEW: 'preview' }

export async function fetchManifest(catalogue = CATALOGUE.HANDBOOK) {
  const url = `${useApi ? API_BASE : ''}/api/handbook/${catalogue}`
  const res = await fetch(url, { headers: authHeader() })
  if (!res.ok) throw new Error(`manifest ${res.status}`)
  return res.json()
}

/**
 * 方案階梯、每一冊的最低方案，以及（有登入的話）自己手上的訂閱。
 *
 * 這一支永遠走真正的 API，即使手冊本身還在讀本機切出來的檔案：權限是後台現改現生效的，
 * 綁在 manifest 上就代表每改一次價格都要重切一次書。拿不到就回 null，書架沿用 manifest
 * 裡切書時算出來的預設值 —— 後台掛了不該讓整個書架消失。
 */
export async function fetchTierConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/handbook/tiers`, { headers: authHeader() })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    return null
  }
}

/**
 * One chapter, as bytes.
 *
 * Resolves to an ArrayBuffer rather than a URL on purpose: a URL can be copied out of the
 * page and shared, and a blob: URL still ends up in the browser's download menu. Handing the
 * renderer raw bytes keeps the file from ever being a thing the viewer can save by itself.
 */
export async function fetchUnit(id, catalogue = CATALOGUE.HANDBOOK) {
  const base = useApi ? API_BASE : ''
  const url = `${base}/api/handbook/${catalogue}/${encodeURIComponent(id)}`
  const res = await fetch(url, { headers: authHeader() })
  // 404 is what the server answers for "you do not own this", deliberately — a 403 would
  // confirm the chapter exists and is merely unpaid.
  if (res.status === 404) throw new Error('locked')
  if (!res.ok) throw new Error(`unit ${res.status}`)
  return res.arrayBuffer()
}

function authHeader() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
