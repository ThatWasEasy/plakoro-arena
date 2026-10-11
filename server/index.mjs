// Login/registration API. No OAuth, no email — a player logs in with an account handle they
// pick plus a PIN, kept separate from their display name (shown on banners, not unique, can
// change) and their organiser-facing P###### code. See docs/data-model.md「登入與註冊流程」for
// why there's no OAuth (no money, no PII, worst case of getting it wrong is a swapped flag).
import express from 'express'
import { randomUUID } from 'node:crypto'
import { nextPlayerCode, pool } from './db.mjs'
import { generateClaimCode, hashSecret, signToken, verifySecret, verifyToken } from './auth.mjs'

const PORT = process.env.PORT || 8787
const ADMIN_SECRET = process.env.ADMIN_SECRET
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET is not set')

const app = express()
app.use(express.json())

// Hand-rolled rather than the `cors` package: no credentials-mode subtleties worth a dependency
// for, just an allow-list to check an origin against.
//
// CORS_ORIGIN can be a comma-separated list, for once there's a real deployed frontend (and
// maybe a staging one alongside it). Any localhost/127.0.0.1 port is trusted outright in
// addition to that list — Vite moves to the next free port the moment 5191 is taken (e.g. two
// dev servers running side by side), and hardcoding one port just breaks the other. That's fine
// to leave wide open for local dev: there's nothing behind this API worth stealing yet (see
// docs/data-model.md's own stance — no money, no PII, worst case is a swapped flag).
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5191').split(',').map(o => o.trim())
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

app.use((req, res, next) => {
  const origin = req.header('origin')
  if (origin && (ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function requireAdmin(req, res, next) {
  if (req.header('x-admin-secret') !== ADMIN_SECRET) return res.status(403).json({ error: 'forbidden' })
  next()
}

function requireAuth(req, res, next) {
  const header = req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = verifyToken(token)
  if (!payload) return res.status(401).json({ error: 'unauthorized' })
  req.playerCode = payload.code
  next()
}

const MIN_PIN_LENGTH = 8

// The login handle, kept deliberately separate from `players.name` (the display nickname shown
// on banners — can duplicate, can be changed) and from `players.code` (the organiser-facing
// P###### id). Lives in auth_identities.subject, which already had a UNIQUE(provider, subject)
// constraint for exactly this — login just never needs to guess which of several same-named
// players it is.
function normalizeAccount(raw) {
  return String(raw || '').trim().toLowerCase()
}

const UNIQUE_VIOLATION = '23505'

// A brand new player has no history to protect, so there is nothing a claim code would be
// guarding — straight to picking an account, a display name and a PIN.
app.post('/api/auth/register', async (req, res) => {
  const account = normalizeAccount(req.body?.account)
  const name = String(req.body?.name || '').trim()
  const pin = String(req.body?.pin || '')
  if (!account) return res.status(400).json({ error: 'account is required' })
  if (!name) return res.status(400).json({ error: 'name is required' })
  if (pin.length < MIN_PIN_LENGTH) return res.status(400).json({ error: `pin must be at least ${MIN_PIN_LENGTH} characters` })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const code = await nextPlayerCode(client)
    await client.query('INSERT INTO players (code, name) VALUES ($1, $2)', [code, name])
    const secretHash = await hashSecret(pin)
    await client.query(
      `INSERT INTO auth_identities (id, provider, subject, code, secret_hash) VALUES ($1, 'claim', $2, $3, $4)`,
      [randomUUID(), account, code, secretHash]
    )
    await client.query('COMMIT')
    res.json({ code, token: signToken(code) })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'account already taken' })
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

// Linking to an existing numbered player (has history, no account yet). The claim code is
// already organiser-issued to one specific player (see claim_codes.player below), so the player
// doesn't need to know or type their own P###### code — just pick the account handle they'll
// log in with from now on. Also doubles as "forgot my PIN" (and "forgot my account handle"): a
// fresh claim code resets both the same way, which is why any existing claim-identity for this
// player is replaced rather than merged.
app.post('/api/auth/claim', async (req, res) => {
  const account = normalizeAccount(req.body?.account)
  const claimCode = String(req.body?.claimCode || '').trim().toUpperCase()
  const pin = String(req.body?.pin || '')
  if (!account) return res.status(400).json({ error: 'account is required' })
  if (!claimCode) return res.status(400).json({ error: 'claimCode is required' })
  if (pin.length < MIN_PIN_LENGTH) return res.status(400).json({ error: `pin must be at least ${MIN_PIN_LENGTH} characters` })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT * FROM claim_codes WHERE code = $1 FOR UPDATE', [claimCode])
    const row = rows[0]
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'claim code not found' }) }
    if (row.used_at) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'claim code already used' }) }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await client.query('ROLLBACK'); return res.status(410).json({ error: 'claim code expired' })
    }

    const code = row.player
    const secretHash = await hashSecret(pin)
    await client.query("DELETE FROM auth_identities WHERE provider = 'claim' AND code = $1", [code])
    await client.query(
      `INSERT INTO auth_identities (id, provider, subject, code, secret_hash) VALUES ($1, 'claim', $2, $3, $4)`,
      [randomUUID(), account, code, secretHash]
    )
    await client.query('UPDATE claim_codes SET used_at = now() WHERE code = $1', [claimCode])
    await client.query('COMMIT')
    res.json({ code, token: signToken(code) })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'account already taken' })
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

app.post('/api/auth/login', async (req, res) => {
  const account = normalizeAccount(req.body?.account)
  const pin = String(req.body?.pin || '')
  const { rows } = await pool.query(
    "SELECT code, secret_hash FROM auth_identities WHERE provider = 'claim' AND subject = $1",
    [account]
  )
  const ok = rows[0] && await verifySecret(pin, rows[0].secret_hash)
  if (!ok) return res.status(401).json({ error: 'wrong account or pin' })
  res.json({ code: rows[0].code, token: signToken(rows[0].code) })
})

app.get('/api/players/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM players WHERE code = $1', [req.playerCode])
  if (!rows.length) return res.status(404).json({ error: 'player not found' })
  // PlayerProfileApp.vue's lock-check needs this to know what's actually earned, not just the
  // tier — a tier alone can't tell a title apart from another, or a mascot from a locked one.
  const { rows: unlocks } = await pool.query(
    'SELECT kind, asset FROM player_unlocks WHERE code = $1 ORDER BY kind, asset', [req.playerCode]
  )
  res.json({ ...rows[0], unlocks })
})

// A `-default` asset (and the one free starter title) needs no grant — see
// docs/data-model.md「3. 授予」: grants only ever record what was *earned*, never the baseline
// everyone starts with. Anything else has to show up in player_unlocks.
const FREE_TIER_SUFFIX = /-default$/
async function isAssetAllowed(code, kind, asset) {
  if (kind !== 'title' && FREE_TIER_SUFFIX.test(asset)) return true
  if (kind === 'title' && asset === 'gen-rookie') return true
  const { rows } = await pool.query(
    'SELECT 1 FROM player_unlocks WHERE code = $1 AND kind = $2 AND asset = $3', [code, kind, asset]
  )
  return rows.length > 0
}

// PlayerProfileApp.vue's own :disabled/locked state is just UX — this is the actual rule (see
// docs/data-model.md「PATCH 的驗證」): a player can rename themselves freely, but an avatar,
// flag or title has to either be free or actually sit in their player_unlocks before it can be
// equipped, no matter what the client sent.
app.patch('/api/players/me', requireAuth, async (req, res) => {
  const code = req.playerCode
  const { name, avatar, background, titleId } = req.body || {}
  const sets = []
  const values = []
  let i = 1

  if (name !== undefined) {
    const trimmed = String(name).trim().slice(0, 20)
    if (!trimmed) return res.status(400).json({ error: 'name is required' })
    sets.push(`name = $${i++}`); values.push(trimmed)
  }
  if (avatar !== undefined) {
    if (!(await isAssetAllowed(code, 'avatar', avatar))) return res.status(400).json({ error: 'avatar not unlocked' })
    sets.push(`avatar = $${i++}`); values.push(avatar)
  }
  if (background !== undefined) {
    if (!(await isAssetAllowed(code, 'background', background))) return res.status(400).json({ error: 'background not unlocked' })
    sets.push(`background = $${i++}`); values.push(background)
  }
  if (titleId !== undefined) {
    if (titleId !== null && !(await isAssetAllowed(code, 'title', titleId))) return res.status(400).json({ error: 'title not unlocked' })
    sets.push(`title_id = $${i++}`); values.push(titleId)
  }

  if (sets.length) {
    values.push(code)
    await pool.query(`UPDATE players SET ${sets.join(', ')} WHERE code = $${i}`, values)
  }
  const { rows } = await pool.query('SELECT * FROM players WHERE code = $1', [code])
  res.json(rows[0])
})

// The in-app admin mode's own login (triple-tap the version number, enter the PIN) — separate
// from `requireAdmin` above, which gates ops-style endpoints behind the ADMIN_SECRET env var.
// This PIN lives in the database (see db/migrations/0003_admin_pin.sql) specifically so it can
// be changed without a redeploy, and issues an ordinary signed token whose `code` is the
// sentinel 'ADMIN' rather than any real player — never a value `nextPlayerCode` can produce.
app.post('/api/admin/login', async (req, res) => {
  const pin = String(req.body?.pin || '')
  const { rows } = await pool.query('SELECT pin_hash FROM admin_pin WHERE id = 1')
  const ok = rows[0] && await verifySecret(pin, rows[0].pin_hash)
  if (!ok) return res.status(401).json({ error: 'wrong pin' })
  res.json({ token: signToken('ADMIN') })
})

function requireAdminSession(req, res, next) {
  const header = req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = verifyToken(token)
  if (!payload || payload.code !== 'ADMIN') return res.status(401).json({ error: 'unauthorized' })
  next()
}

// Search box behind "切換身份" — by code or by name, since nobody running this at a table has
// every P###### memorised.
app.get('/api/admin/players', requireAdminSession, async (req, res) => {
  const q = String(req.query.q || '').trim()
  const { rows } = await pool.query(
    `SELECT code, name FROM players WHERE code ILIKE $1 OR name ILIKE $1 ORDER BY code LIMIT 20`,
    [`%${q}%`]
  )
  res.json({ players: rows })
})

// The full picture for one player: their equipped look + stats, and everything they've
// actually unlocked (not just what's equipped) — same two pieces PlayerProfileApp.vue needs for
// its own signed-in player, read here instead of assumed.
app.get('/api/admin/players/:code', requireAdminSession, async (req, res) => {
  const code = String(req.params.code).trim().toUpperCase()
  const { rows } = await pool.query('SELECT * FROM players WHERE code = $1', [code])
  if (!rows.length) return res.status(404).json({ error: 'no such player' })
  const { rows: unlocks } = await pool.query(
    'SELECT kind, asset FROM player_unlocks WHERE code = $1 ORDER BY kind, asset', [code]
  )
  res.json({ player: rows[0], unlocks })
})

// The reverse direction of the upload below: pick a tournament that's already in the database
// back into the client-side editor. Lets a device whose localStorage never had the event (or
// lost it) get it back, same as re-importing an exported file — the detail endpoint below
// deliberately returns the same plakoro-tournament v2 shape tournamentTransfer.js already knows
// how to read, so the client has nothing new to parse.
app.get('/api/admin/tournaments', requireAdminSession, async (req, res) => {
  const { rows } = await pool.query(
    // Cast to text rather than letting node-postgres hand back a Date object — `res.json` would
    // then serialize it as a full UTC timestamp, which both reads wrong in the picker and can
    // shift the date by a day depending on the browser's timezone.
    "SELECT id, name, date::text AS date, venue, total_rounds, format FROM tournaments ORDER BY date DESC, name"
  )
  res.json({ tournaments: rows })
})

app.get('/api/admin/tournaments/:id', requireAdminSession, async (req, res) => {
  const id = req.params.id
  // date::text for the same reason as the list endpoint above — node-postgres hands back a
  // DATE column as a Date object built from *local* time components, so `.toISOString()`
  // below would silently shift it a day whenever the server's local timezone is ahead of UTC.
  const { rows: tRows } = await pool.query(
    "SELECT id, name, date::text AS date, venue, total_rounds, format FROM tournaments WHERE id = $1", [id]
  )
  if (!tRows.length) return res.status(404).json({ error: 'no such tournament' })
  const t = tRows[0]

  const { rows: players } = await pool.query(
    `SELECT tp.code, p.name FROM tournament_players tp JOIN players p ON p.code = tp.code WHERE tp.tournament_id = $1`,
    [id]
  )
  const { rows: matches } = await pool.query(
    'SELECT round_number, p1, p2, result FROM matches WHERE tournament_id = $1 ORDER BY round_number', [id]
  )

  // Grouped by round, and each match named by code — codes are already unique, so there's none
  // of the "two players with the same name" ambiguity a file export has to dodge with `ref`.
  const byRound = new Map()
  for (const m of matches) {
    if (!byRound.has(m.round_number)) byRound.set(m.round_number, [])
    const out = { a: m.p1 }
    if (m.p2 === null) {
      out.bye = true
    } else {
      out.b = m.p2
      if (m.result === 'draw') out.draw = true
      else if (m.result === 'p1') out.winner = m.p1
      else if (m.result === 'p2') out.winner = m.p2
    }
    byRound.get(m.round_number).push(out)
  }

  res.json({
    format: 'plakoro-tournament',
    version: 2,
    name: t.name,
    date: t.date,
    ...(t.venue ? { venue: t.venue } : {}),
    system: t.format,
    ...(t.total_rounds ? { totalRounds: t.total_rounds } : {}),
    players: players.map(p => ({ name: p.name, ref: p.code, code: p.code })),
    rounds: [...byRound.keys()].sort((a, b) => a - b).map(n => ({ round: n, matches: byRound.get(n) }))
  })
})

// The cloud-side half of deleting a tournament from the local editor's list (see
// TournamentApp.vue's "also delete from cloud" option) — removes the tournament row and, via
// ON DELETE CASCADE, its tournament_players and matches rows. Deliberately does NOT touch
// player_unlocks: a grant already handed out is kept (same stance as everywhere else — unlocks
// are only ever added, never revoked automatically), so this is safe to use on a real event
// without undoing anyone's earned rewards. Idempotent: deleting an id that was never uploaded,
// or already removed, just affects zero rows.
app.delete('/api/admin/tournaments/:id', requireAdminSession, async (req, res) => {
  await pool.query('DELETE FROM tournaments WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// Admin-configurable tournament rewards (db/migrations/0005_reward_packages.sql). A package
// bundles what each placement tier (1st/2nd/3rd/participant) actually gets — any mix of
// avatar/background/title — so a new event's rewards are a few clicks here rather than a code
// change, and titles can be granted automatically instead of staying a manual SQL step forever.
app.get('/api/admin/reward-packages', requireAdminSession, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name FROM reward_packages ORDER BY created_at DESC')
  res.json({ packages: rows })
})

app.get('/api/admin/reward-packages/:id', requireAdminSession, async (req, res) => {
  const id = req.params.id
  const { rows } = await pool.query('SELECT id, name FROM reward_packages WHERE id = $1', [id])
  if (!rows.length) return res.status(404).json({ error: 'no such package' })
  const { rows: items } = await pool.query(
    'SELECT place, kind, asset FROM reward_package_items WHERE package_id = $1', [id]
  )
  res.json({ ...rows[0], items })
})

// Full replace of a package's items on every save, same shape as a tournament's matches —
// simplest way to guarantee no stale item survives an edit (an item removed in the editor has
// no "diff" to send, so starting clean each time is the only option that can't miss one).
app.put('/api/admin/reward-packages/:id', requireAdminSession, async (req, res) => {
  const id = String(req.params.id || '').trim()
  const body = req.body || {}
  const name = String(body.name || '').trim()
  if (!id) return res.status(400).json({ error: 'id is required' })
  if (!name) return res.status(400).json({ error: 'name is required' })
  const items = Array.isArray(body.items) ? body.items : []

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO reward_packages (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [id, name]
    )
    await client.query('DELETE FROM reward_package_items WHERE package_id = $1', [id])
    for (const item of items) {
      if (!['1', '2', '3', 'participant'].includes(item.place)) continue
      if (!['avatar', 'background', 'title'].includes(item.kind)) continue
      if (!item.asset) continue
      await client.query(
        'INSERT INTO reward_package_items (package_id, place, kind, asset) VALUES ($1, $2, $3, $4)',
        [id, item.place, item.kind, item.asset]
      )
    }
    await client.query('COMMIT')
    res.json({ id, name, items })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

app.delete('/api/admin/reward-packages/:id', requireAdminSession, async (req, res) => {
  await pool.query('DELETE FROM reward_packages WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// Players and matches arrive keyed by the editor's own internal uuids (`id`/`p1Id`/`p2Id`), not
// by code: a brand-new walk-in has no code yet, and resolving "assign one" and "use the one that
// already exists" in the same pass is what lets a half-registered event upload in one request
// instead of two. The response hands the id→code mapping back so the editor can save newly
// assigned codes onto its own local copy, keeping a re-upload idempotent instead of minting a
// fresh player every time.
app.post('/api/admin/tournaments', requireAdminSession, async (req, res) => {
  const body = req.body || {}
  const tournamentId = String(body.id || '').trim()
  const rewardPackageId = body.rewardPackageId ? String(body.rewardPackageId).trim() : null
  if (!tournamentId) return res.status(400).json({ error: 'id is required' })
  if (!body.date) return res.status(400).json({ error: 'date is required' })
  if (!Array.isArray(body.players) || !body.players.length) return res.status(400).json({ error: 'players is required' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Resolve every player to a code — reuse one if given and already on file, mint one via
    // the same sequence self-registration uses otherwise. Never overwrites an existing player's
    // name: it's theirs to change in their own profile, not a tournament roster's to correct.
    const idToCode = new Map()
    const touchedCodes = []
    for (const p of body.players) {
      let code = String(p.code || '').trim().toUpperCase()
      const name = String(p.name || '').trim() || code || 'Player'
      if (code) {
        const { rows } = await client.query('SELECT 1 FROM players WHERE code = $1', [code])
        if (!rows.length) await client.query('INSERT INTO players (code, name) VALUES ($1, $2)', [code, name])
      } else {
        code = await nextPlayerCode(client)
        await client.query('INSERT INTO players (code, name) VALUES ($1, $2)', [code, name])
      }
      idToCode.set(p.id, code)
      touchedCodes.push(code)
    }

    // 2. The event itself — upsert, so re-uploading after fixing a typo'd name/date just corrects it.
    const format = body.format === 'elimination' ? 'elimination' : 'swiss'
    await client.query(
      `INSERT INTO tournaments (id, name, date, venue, total_rounds, format) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, date = EXCLUDED.date, venue = EXCLUDED.venue, total_rounds = EXCLUDED.total_rounds, format = EXCLUDED.format`,
      [tournamentId, String(body.name || ''), body.date, body.venue || null, body.totalRounds || null, format]
    )

    // 3. Roster + placement. `place` is null until the editor considers the event finished (see
    // isFullyPlayed in src/game/playerBadges.js) — the client holds off sending a real place
    // before then, same principle as "a round-one leader isn't the champion yet".
    for (const p of body.players) {
      await client.query(
        `INSERT INTO tournament_players (tournament_id, code, place) VALUES ($1, $2, $3)
         ON CONFLICT (tournament_id, code) DO UPDATE SET place = EXCLUDED.place`,
        [tournamentId, idToCode.get(p.id), p.place ?? null]
      )
    }

    // 4. Matches — full replace rather than trying to diff individual rows: match ids aren't
    // stable across re-uploads of the same event (a result can be corrected, a round re-paired),
    // so starting clean each time is the only way that can't leave a stale row behind.
    await client.query('DELETE FROM matches WHERE tournament_id = $1', [tournamentId])
    for (const m of (body.matches || [])) {
      const p1 = idToCode.get(m.p1Id)
      if (!p1) continue
      const p2 = m.p2Id ? idToCode.get(m.p2Id) : null
      await client.query(
        'INSERT INTO matches (id, tournament_id, round_number, p1, p2, result) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), tournamentId, m.round, p1, p2, m.result || null]
      )
    }

    // 5. Grant rewards from the selected package (see /api/admin/reward-packages below) — each
    // placement tier (1st/2nd/3rd/participant) carries whatever avatar/background/title the
    // admin configured for it, independently. Replaces the old hardcoded
    // `${season}-participants`/`-champion`/`-winner` naming convention, which could only ever
    // grant tier-suffixed avatars/flags and never titles at all. Optional: a tournament can be
    // uploaded with no package, which just skips granting anything.
    if (rewardPackageId) {
      const { rows: pkgRows } = await client.query('SELECT 1 FROM reward_packages WHERE id = $1', [rewardPackageId])
      if (!pkgRows.length) throw new Error('no such reward package')
      const { rows: items } = await client.query(
        'SELECT place, kind, asset FROM reward_package_items WHERE package_id = $1', [rewardPackageId]
      )
      for (const item of items) {
        if (item.place === 'participant') {
          await client.query(
            `INSERT INTO player_unlocks (code, kind, asset, src)
             SELECT tp.code, $2, $3, 'auto:upload' FROM tournament_players tp WHERE tp.tournament_id = $1
             ON CONFLICT (code, kind, asset) DO NOTHING`,
            [tournamentId, item.kind, item.asset]
          )
        } else {
          await client.query(
            `INSERT INTO player_unlocks (code, kind, asset, src)
             SELECT tp.code, $2, $3, 'auto:upload' FROM tournament_players tp WHERE tp.tournament_id = $1 AND tp.place = $4
             ON CONFLICT (code, kind, asset) DO NOTHING`,
            [tournamentId, item.kind, item.asset, Number(item.place)]
          )
        }
      }
    }

    // 6. Recompute, scoped to the players this upload actually touched (see docs/data-model.md
    // 「4. 重算」for the unscoped version the real write path uses — scoping it here is just
    // this one-off endpoint being conservative about what it touches).
    await client.query(
      `UPDATE players SET
         events = s.events, ranked = s.ranked,
         tour_wins = s.tour_wins, tour_losses = s.tour_losses, tour_draws = s.tour_draws, tour_byes = s.tour_byes,
         tour_win_rate = s.tour_win_rate,
         gold = s.gold, silver = s.silver, bronze = s.bronze, podiums = s.podiums, best = s.best,
         stats_at = now()
       FROM player_stats s
       WHERE s.code = players.code AND players.code = ANY($1::text[])`,
      [touchedCodes]
    )

    await client.query('COMMIT')
    res.json({
      tournamentId,
      players: body.players.map(p => ({ id: p.id, code: idToCode.get(p.id) }))
    })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

// Organiser-only: mint a one-time claim code for an existing player, to hand over however they
// normally reach that person — this endpoint doesn't care how it gets delivered.
app.post('/api/admin/claim-codes', requireAdmin, async (req, res) => {
  const playerCode = String(req.body?.code || '').trim().toUpperCase()
  const { rows } = await pool.query('SELECT 1 FROM players WHERE code = $1', [playerCode])
  if (!rows.length) return res.status(404).json({ error: 'no such player' })
  const claimCode = generateClaimCode()
  await pool.query(
    "INSERT INTO claim_codes (code, player, expires_at) VALUES ($1, $2, now() + interval '14 days')",
    [claimCode, playerCode]
  )
  res.json({ claimCode })
})

app.listen(PORT, () => console.log(`plakoro API listening on :${PORT}`))
