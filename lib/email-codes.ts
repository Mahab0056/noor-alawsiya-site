import 'server-only';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { deriveKey } from './auth';
import type { Db } from './db';
import { loginCodeEmail, sendMail, type Fetch, type MailConfig } from './mail';

/**
 * The second step of an admin sign-in when the authenticator app is off (lib/flags.ts): a 6-digit code sent by e-mail.
 *
 * - Issued only after the right password, for an active admin, on a device that is not remembered.
 * - One use, CODE_MINUTES, CODE_TRIES wrong tries; a newer code ends the older ones; at most CODES_PER_HOUR per admin.
 * - The code is never stored: only HMAC-SHA256(key from APP_SECRET, challenge + code). The challenge is 32 random bytes
 *   kept in a short-lived cookie (only its sha256 is stored), so a code is useless without the browser that asked for it.
 * - Compared in constant time. Nothing here logs the address or the code.
 *
 * «Remember this device» stores a random token in a cookie for DEVICE_DAYS (sha256 only in the database). Disabling or
 * re-inviting an admin forgets all their devices and codes.
 */

export const CODE_MINUTES = 10;
export const CODE_TRIES = 5;
export const CODES_PER_HOUR = 5;
export const DEVICE_DAYS = 30;
const MAX_DEVICES = 10; // per admin; the oldest is dropped

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const mac = (challenge: string, code: string) => createHmac('sha256', Buffer.from(deriveKey('noor-login-code'))).update(`${challenge}:${code}`).digest('hex');

/** Western or Arabic-Indic digits, spaces ignored. */
export const normalizeCode = (input: string) => input.replace(/\s/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

export type CodeDeps = { mail: MailConfig; fetchImpl?: Fetch };
export type IssueResult = { ok: true; challenge: string } | { ok: false; reason: 'throttled' };

/**
 * Makes a code and sends it. The row is written in a short transaction (the hourly cap is checked under a row lock),
 * then the e-mail is sent outside it, so a slow Resend call holds no lock and no extra connection. If Resend refuses,
 * the row is deleted and this throws. Returns the challenge for the cookie.
 */
export async function issueLoginCode(db: Db, adminId: number, email: string, deps: CodeDeps): Promise<IssueResult> {
  const issued = await db.tx(async (t) => {
    // One issuer at a time per admin, so the hourly cap holds under parallel requests.
    await t.query('select id from admins where id = $1 for update', [adminId]);
    const [{ n }] = await t.query<{ n: string }>(`select count(*) as n from admin_login_codes where admin_id = $1 and created_at > now() - interval '1 hour'`, [adminId]);
    if (Number(n) >= CODES_PER_HOUR) return { ok: false, reason: 'throttled' } as const;
    await t.query(`delete from admin_login_codes where admin_id = $1 and created_at < now() - interval '1 day'`, [adminId]);
    await t.query('update admin_login_codes set used_at = now() where admin_id = $1 and used_at is null', [adminId]); // only the newest code works
    const challenge = randomBytes(32).toString('base64url');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const [row] = await t.query<{ id: string }>(
      `insert into admin_login_codes (admin_id, challenge_hash, code_mac, expires_at) values ($1, $2, $3, now() + interval '${CODE_MINUTES} minutes') returning id`,
      [adminId, sha256(challenge), mac(challenge, code)]
    );
    return { ok: true, challenge, code, id: Number(row.id) } as const;
  });
  if (!issued.ok) return issued;
  try {
    await sendMail(deps.mail, { to: email, ...loginCodeEmail(issued.code, CODE_MINUTES) }, deps.fetchImpl);
  } catch (e) {
    await db.query('delete from admin_login_codes where id = $1', [issued.id]);
    throw e;
  }
  return { ok: true, challenge: issued.challenge };
}

export type VerifyResult = { ok: true; adminId: number } | { ok: false; reason: 'code'; triesLeft: number } | { ok: false; reason: 'expired' };

/**
 * Checks a code against the challenge from the cookie. Every submission uses up one try first (atomically), so
 * parallel guesses cannot get more than CODE_TRIES. A right code is claimed once; the admin must still be active.
 */
export async function verifyLoginCode(db: Db, challenge: string | undefined, codeInput: string): Promise<VerifyResult> {
  if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return { ok: false, reason: 'expired' };
  const [row] = await db.query<{ id: string; admin_id: string; code_mac: string; attempts: number }>(
    `update admin_login_codes set attempts = attempts + 1
     where challenge_hash = $1 and used_at is null and expires_at > now() and attempts < ${CODE_TRIES}
     returning id, admin_id, code_mac, attempts`,
    [sha256(challenge)]
  );
  if (!row) return { ok: false, reason: 'expired' };
  const code = normalizeCode(codeInput);
  const given = Buffer.from(/^\d{6}$/.test(code) ? mac(challenge, code) : '0'.repeat(64), 'hex');
  const right = timingSafeEqual(given, Buffer.from(row.code_mac, 'hex')) && /^\d{6}$/.test(code);
  if (!right) {
    const triesLeft = CODE_TRIES - Number(row.attempts);
    return triesLeft > 0 ? { ok: false, reason: 'code', triesLeft } : { ok: false, reason: 'expired' };
  }
  const claimed = await db.query<{ admin_id: string }>(
    `update admin_login_codes c set used_at = now()
     where c.id = $1 and c.used_at is null
       and exists (select 1 from admins a where a.id = c.admin_id and a.activated_at is not null and a.disabled_at is null)
     returning c.admin_id`,
    [row.id]
  );
  if (claimed.length !== 1) return { ok: false, reason: 'expired' };
  await db.query('update admins set last_login_at = now() where id = $1', [claimed[0].admin_id]);
  return { ok: true, adminId: Number(claimed[0].admin_id) };
}

// ---------------------------------------------------------------- remembered devices

/** Returns the raw token for the cookie (only its hash is stored), or null if the admin is no longer active. */
export async function rememberDevice(db: Db, adminId: number): Promise<{ token: string; expiresAt: Date } | null> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DEVICE_DAYS * 24 * 3600_000);
  const stored = await db.tx(async (t) => {
    await t.query('delete from admin_devices where expires_at < now()');
    // Locks the admin row, so a disable or re-invite in parallel either comes first (nothing stored) or after (and forgets it).
    const [active] = await t.query('select id from admins where id = $1 and activated_at is not null and disabled_at is null for update', [adminId]);
    if (!active) return false;
    await t.query('insert into admin_devices (admin_id, token_hash, expires_at) values ($1, $2, $3)', [adminId, sha256(token), expiresAt]);
    await t.query(
      `delete from admin_devices where admin_id = $1 and id not in (select id from admin_devices where admin_id = $1 order by created_at desc, id desc limit ${MAX_DEVICES})`,
      [adminId]
    );
    return true;
  });
  return stored ? { token, expiresAt } : null;
}

/** True only for an unexpired token remembered by this same admin. */
export async function isRememberedDevice(db: Db, adminId: number, token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const rows = await db.query('select 1 from admin_devices where admin_id = $1 and token_hash = $2 and expires_at > now()', [adminId, sha256(token)]);
  return rows.length === 1;
}

/** Forget every remembered device and open code of an admin (disable, re-invite, reset). */
export async function forgetAdminDevices(db: Db, adminId: number) {
  await db.query('delete from admin_devices where admin_id = $1', [adminId]);
  await db.query('delete from admin_login_codes where admin_id = $1', [adminId]);
}
