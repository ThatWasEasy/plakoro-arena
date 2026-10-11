// Applies every .sql file in db/migrations/ that schema_migrations doesn't already list, in
// filename order. Run with `npm run db:migrate` — add a new file (0002_whatever.sql) rather
// than editing an applied one, the same rule any migration tool enforces.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env (and `npm run db:up` first).')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`)

const applied = new Set(
  (await client.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename)
)

const pending = readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !applied.has(f)).sort()

for (const file of pending) {
  console.log(`applying ${file}`)
  try {
    await client.query('BEGIN')
    await client.query(readFileSync(join(migrationsDir, file), 'utf8'))
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(`${file} failed:`, err.message)
    process.exit(1)
  }
}

console.log(pending.length ? `done — applied ${pending.length} migration(s)` : 'nothing to do')
await client.end()
