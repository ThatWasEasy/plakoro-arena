// Sets (or resets) the admin PIN used by the in-app admin mode — see
// db/migrations/0003_admin_pin.sql. Run after db:migrate:
//
//   node --env-file-if-exists=.env db/seed-admin-pin.mjs <pin>
//
// No default on purpose — whatever PIN unlocks admin mode should only ever exist as a hash in
// the database, never as a literal value sitting in version control.
import { hashSecret } from '../server/auth.mjs'
import { pool } from '../server/db.mjs'

const pin = process.argv[2]
if (!pin) {
  console.error('usage: node db/seed-admin-pin.mjs <pin>')
  process.exit(1)
}

const pinHash = await hashSecret(pin)
await pool.query(
  `INSERT INTO admin_pin (id, pin_hash, updated_at) VALUES (1, $1, now())
   ON CONFLICT (id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now()`,
  [pinHash]
)
console.log(`admin PIN set (${pin.length} digits)`)
await pool.end()
