import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

export const pool = new pg.Pool({ connectionString })

// Players self-registering get the next free P###### — a Postgres sequence would race-proof
// this, but at meetup scale (a handful of signups, never at the same instant) the simpler
// MAX+1 reads fine. Codes handed out by hand before this system existed (P000001..) are
// `^P[0-9]+$` too, so new ones never collide with them.
export async function nextPlayerCode(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(substring(code from 2)::int), 0) + 1 AS n FROM players WHERE code ~ '^P[0-9]+$'`
  )
  return 'P' + String(rows[0].n).padStart(6, '0')
}
