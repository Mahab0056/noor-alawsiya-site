import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from './db';

/**
 * Authentication core: password hashing, sessions, login throttling and TOTP.
 * No framework code here; cookies are handled in lib/session.ts.
 */

// ---------------------------------------------------------------- passwords (argon2id)

export { MIN_PASSWORD } from './form-rules';

export const hashPassword = (password: string) => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

export async function verifyPassword(stored: string, password: string) {
  try {
    return await verify(stored, password);
  } catch {
    return false; // malformed hash
  }
}

// A real hash to compare against when the account does not exist, so both paths take similar time.
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

// ---------------------------------------------------------------- identifiers

/** Iraqi mobile numbers, stored as 07XXXXXXXXX. Accepts +964 / 00964 / spaces / Arabic digits. */
export { normalizePhone } from './form-rules';

export const normalizeEmail = (input: string) => input.trim().toLowerCase();

// ---------------------------------------------------------------- sessions

export type SessionKind = 'student' | 'admin';
export type Session = { kind: SessionKind; userId: number; expiresAt: Date };

const TTL_MS: Record<SessionKind, number> = { student: 30 * 24 * 3600_000, admin: 12 * 3600_000 };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(db: Db, kind: SessionKind, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS[kind]);
  await db.query('delete from sessions where expires_at < now()');
  await db.query(`insert into sessions (token_hash, kind, ${kind === 'student' ? 'student_id' : 'admin_id'}, expires_at) values ($1, $2, $3, $4)`, [sha256(token), kind, userId, expiresAt]);
  return { token, expiresAt };
}

export async function readSession(db: Db, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [row] = await db.query<{ kind: SessionKind; student_id: string | null; admin_id: string | null; expires_at: Date }>(
    'select kind, student_id, admin_id, expires_at from sessions where token_hash = $1 and expires_at > now()',
    [sha256(token)]
  );
  if (!row) return null;
  return { kind: row.kind, userId: Number(row.kind === 'student' ? row.student_id : row.admin_id), expiresAt: new Date(row.expires_at) };
}

export async function destroySession(db: Db, token: string | undefined) {
  if (token) await db.query('delete from sessions where token_hash = $1', [sha256(token)]);
}

// ---------------------------------------------------------------- login throttling

const WINDOW = '15 minutes';
const MAX_PER_IDENTIFIER = 5;
const MAX_PER_IP = 20;

/**
 * Atomic check-and-reserve. In one short transaction, take a lock on this identifier and on this address, count the
 * recent failures, and only if under the limits write this attempt as a failure BEFORE the password is checked.
 * Parallel requests for the same identifier or address queue on the lock, so at most MAX of them get through however
 * many arrive at once. (Checking first and writing after the password check let a burst of parallel requests all pass:
 * 300 of 300 in the review of 7d94546.) A refused attempt writes nothing, so hammering a locked identifier does not
 * extend the lock. Locks are always taken identifier first, then address, so two requests cannot deadlock.
 */
export async function reserveAttempt(db: Db, scope: SessionKind, identifier: string, ip: string): Promise<{ id: number; throttled: boolean }> {
  await db.query(`delete from login_attempts where created_at < now() - interval '1 day'`);
  return db.tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock(1, hashtext($1 || ':' || $2))`, [scope, identifier]);
    await t.query(`select pg_advisory_xact_lock(2, hashtext($1 || ':' || $2))`, [scope, ip]);
    const [row] = await t.query<{ by_id: string; by_ip: string }>(
      // Admins: the per-identifier count only includes failures from this address. Guessing an admin password gets
      // nowhere without the TOTP code, so a global per-email lock would only let a stranger lock the owner out.
      `select count(*) filter (where identifier = $2${scope === 'admin' ? ' and ip = $3' : ''}) as by_id, count(*) filter (where ip = $3) as by_ip
       from login_attempts
       where scope = $1 and not succeeded and created_at > now() - interval '${WINDOW}' and (identifier = $2 or ip = $3)`,
      [scope, identifier, ip]
    );
    if (Number(row.by_id) >= MAX_PER_IDENTIFIER || Number(row.by_ip) >= MAX_PER_IP) return { id: 0, throttled: true };
    const [{ id }] = await t.query<{ id: string }>('insert into login_attempts (scope, identifier, ip, succeeded) values ($1, $2, $3, false) returning id', [scope, identifier, ip]);
    return { id: Number(id), throttled: false };
  });
}

/** The reserved attempt turned out fine. Earlier failures stay: they age out, a success does not clear them. */
export async function markAttemptSucceeded(db: Db, id: number) {
  await db.query('update login_attempts set succeeded = true where id = $1', [id]);
}

// ---------------------------------------------------------------- registration throttling

const MAX_REGISTRATIONS_PER_IP = 8; // per hour; a family or a school office registering several children stays under it

/** Counts one registration submission from this address and says whether it is still within the limit (atomic, as above). */
export async function allowRegistration(db: Db, ip: string) {
  await db.query(`delete from registration_attempts where created_at < now() - interval '1 day'`);
  return db.tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock(3, hashtext($1))`, [ip]);
    const [row] = await t.query<{ n: string }>(`select count(*) as n from registration_attempts where ip = $1 and created_at > now() - interval '1 hour'`, [ip]);
    if (Number(row.n) >= MAX_REGISTRATIONS_PER_IP) return false;
    await t.query('insert into registration_attempts (ip) values ($1)', [ip]);
    return true;
  });
}

// ---------------------------------------------------------------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g)!.map((c) => B32[parseInt(c, 2)]).join('');
}

function base32Decode(secret: string) {
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('bad base32');
    bits += v.toString(2).padStart(5, '0');
  }
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

export function totpAt(secret: string, timeMs: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/**
 * Accepts the current code and one step either side, for clock drift. Returns the 30-second step the code
 * belongs to, or null. The caller stores the step so the same code cannot be used twice.
 */
export function matchTotpStep(secret: string, code: string, now = Date.now()): number | null {
  const digits = code.replace(/\s/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!/^\d{6}$/.test(digits)) return null;
  const given = Buffer.from(digits);
  let found: number | null = null;
  for (const offset of [-1, 0, 1]) {
    const at = now + offset * 30_000;
    if (timingSafeEqual(given, Buffer.from(totpAt(secret, at)))) found = Math.floor(at / 30_000);
  }
  return found;
}

export const verifyTotp = (secret: string, code: string, now = Date.now()) => matchTotpStep(secret, code, now) !== null;

export const totpUri = (secret: string, email: string) => `otpauth://totp/${encodeURIComponent('نور الأوصياء')}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent('نور الأوصياء')}`;

// ---------------------------------------------------------------- secrets at rest (TOTP secret in the admins table)

function appKey() {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    // The fallback key is public. It is only for the local development database, never for a real one.
    if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('APP_SECRET is not set.');
    return hkdfSync('sha256', 'dev-only-secret', '', 'noor-totp', 32);
  }
  if (secret.length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
  return hkdfSync('sha256', secret, '', 'noor-totp', 32);
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(appKey()), iv, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function unseal(sealed: string) {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (tag?.length !== 16) throw new Error('bad sealed value');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(appKey()), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
