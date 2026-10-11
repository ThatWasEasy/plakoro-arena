// Everything auth-shaped that doesn't touch the database directly: hashing a PIN, signing a
// session token, minting a claim code. No bcrypt, no jsonwebtoken — node:crypto already has
// scrypt and hmac, and the token only ever carries one field, so a library buys nothing here.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

export async function hashSecret(secret) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(secret, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifySecret(secret, stored) {
  if (!stored) return false
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const hash = Buffer.from(hashHex, 'hex')
  const candidate = await scryptAsync(secret, salt, 64)
  return candidate.length === hash.length && timingSafeEqual(candidate, hash)
}

// Uppercase, no 0/O or 1/I — read aloud or copied off a phone screen, those are the pairs
// people actually get wrong.
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generateClaimCode() {
  const pick = () => CLAIM_ALPHABET[randomBytes(1)[0] % CLAIM_ALPHABET.length]
  const group = () => Array.from({ length: 4 }, pick).join('')
  return `${group()}-${group()}`
}

const SESSION_SECRET = process.env.AUTH_SECRET
if (!SESSION_SECRET) throw new Error('AUTH_SECRET is not set')

// A signed session token — not a JWT, just enough of one. The payload is a player code and an
// issue time; anyone can read it (base64url, not encrypted), but the signature is what proves
// this server issued it, which is the only property a session token needs here.
export function signToken(code) {
  const payload = Buffer.from(JSON.stringify({ code, iat: Date.now() })).toString('base64url')
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyToken(token) {
  if (!token) return null
  const [payload, sig] = String(token).split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
