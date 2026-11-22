import 'server-only';
import { createHash, createHmac, hkdfSync, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from './db';

/**
 * Authentication core: password hashing, sessions, login throttling and the emailed login codes.
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
// Admins sign in with an e-mailed code and no password, so the per-identifier count is per e-mail from ALL addresses
// (as on the live site since PR #10): it bounds guessing a six-digit code at 20 an hour per admin. The price is that a
// stranger can lock an admin out for 15 minutes; a super admin can clear that (lib/invites.ts unlockAdmin).

/**
 * Atomic check-and-reserve. In one short transaction, take a lock on this identifier and on this address, count the
 * recent failures, and only if under the limits write this attempt as a failure BEFORE the password or code is checked.
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
      `select count(*) filter (where identifier = $2) as by_id, count(*) filter (where ip = $3) as by_ip
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

// ---------------------------------------------------------------- six-digit codes

/** Strips spaces and turns Arabic-Indic digits into ASCII, so a code typed on an Arabic keyboard works. */
export const normalizeDigits = (code: string) => code.replace(/\s/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** A fresh six-digit login code. randomInt is uniform, unlike randomBytes % 1e6. */
export const newLoginCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Login codes are keyed with APP_SECRET rather than plainly hashed: a million candidates fall in
 * a moment to anyone holding the table, and the key is not in the database.
 */
export const hashLoginCode = (code: string) => createHmac('sha256', Buffer.from(deriveKey('noor-login-code'))).update(code).digest('hex');

// ---------------------------------------------------------------- key derivation

/** A 32-byte key derived from APP_SECRET for one purpose (`info`). Different purposes never share a key. */
export function deriveKey(info: string) {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    // The fallback key is public. It is only for the local development database, never for a real one.
    if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('APP_SECRET is not set.');
    return hkdfSync('sha256', 'dev-only-secret', '', info, 32);
  }
  if (secret.length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
  return hkdfSync('sha256', secret, '', info, 32);
}
