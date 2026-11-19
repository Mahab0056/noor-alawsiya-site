import 'server-only';
import { dummyHash, hashPassword, markAttemptSucceeded, MIN_PASSWORD, newTotpSecret, normalizeEmail, normalizePhone, reserveAttempt, seal, unseal, matchTotpStep, verifyPassword } from './auth';
import type { Db } from './db';
import { isRememberedDevice, issueLoginCode, type CodeDeps } from './email-codes';
import { adminTotpEnabled } from './flags';
import type { AdminRole } from './invites';
import { mailConfig } from './mail';

/** Logging in: students by phone and password; admins by e-mail and password, then a code (e-mail, or app if ADMIN_TOTP=1). */

import { MAX_ACCOUNTS_PER_PHONE } from './form-rules';

export type LoginFailure = 'invalid' | 'throttled';

export type StudentLogin = { ok: true; studentId: number } | { ok: false; reason: LoginFailure } | { ok: false; reason: 'choose'; names: string[] };

/**
 * Siblings may share a guardian's phone, so one phone can have several accounts. The password
 * picks the account; if it matches more than one, the student chooses their name.
 */
export async function loginStudent(db: Db, phoneInput: string, password: string, ip: string, fullName?: string): Promise<StudentLogin> {
  const phone = normalizePhone(phoneInput);
  const identifier = phone ?? 'invalid-phone'; // never store what was typed: it may be a password in the wrong box
  const attempt = await reserveAttempt(db, 'student', identifier, ip);
  if (attempt.throttled) return { ok: false, reason: 'throttled' };

  const accounts = phone ? await db.query<{ id: string; full_name: string; password_hash: string }>('select id, full_name, password_hash from students where phone = $1 order by id limit $2', [phone, MAX_ACCOUNTS_PER_PHONE]) : [];
  const matches: { id: number; name: string }[] = [];
  if (accounts.length === 0) await verifyPassword(await dummyHash(), password); // same cost as a real check
  for (const a of accounts) {
    if (await verifyPassword(a.password_hash, password)) matches.push({ id: Number(a.id), name: a.full_name });
  }

  const chosen = matches.length === 1 ? matches[0] : matches.find((m) => m.name === fullName);
  if (chosen) {
    await markAttemptSucceeded(db, attempt.id);
    return { ok: true, studentId: chosen.id };
  }
  if (matches.length > 1) {
    await markAttemptSucceeded(db, attempt.id); // the password was right; only the name is still to choose
    return { ok: false, reason: 'choose', names: matches.map((m) => m.name) };
  }
  return { ok: false, reason: 'invalid' }; // the reserved row stays as the failure
}

export type AdminLogin =
  | { ok: true; adminId: number }
  | { ok: false; reason: LoginFailure }
  | { ok: false; reason: 'code-sent'; challenge: string }
  | { ok: false; reason: 'mail-failed' };

export type AdminLoginOptions = { deviceToken?: string; codeDeps?: () => CodeDeps };

/**
 * Admin sign-in.
 * - ADMIN_TOTP=1 and the admin has an authenticator: password and app code are checked together and fail the same way,
 *   so a wrong code does not confirm the password (the original path).
 * - Otherwise (the default): the password alone; then, unless this device is remembered for this admin, a 6-digit code
 *   is e-mailed and the answer is 'code-sent' with the challenge for the cookie (lib/email-codes.ts).
 */
export async function loginAdmin(db: Db, emailInput: string, password: string, code: string, ip: string, opts: AdminLoginOptions = {}): Promise<AdminLogin> {
  const email = normalizeEmail(emailInput).slice(0, 200);
  // A device this admin marked as remembered is exempt from the all-address ceiling (lib/auth.ts), not from the others.
  const [known] = opts.deviceToken ? await db.query<{ id: string }>('select id from admins where lower(email) = $1', [email]) : [];
  const trustedDevice = known ? await isRememberedDevice(db, Number(known.id), opts.deviceToken) : false;
  const attempt = await reserveAttempt(db, 'admin', email, ip, { trustedDevice });
  if (attempt.throttled) return { ok: false, reason: 'throttled' };

  const [admin] = await db.query<{ id: string; email: string; password_hash: string; totp_secret: string | null; totp_last_step: string | null }>(
    // Only active admins: a pending admin (invited, not finished) or a disabled one cannot sign in.
    'select id, email, password_hash, totp_secret, totp_last_step from admins where lower(email) = $1 and activated_at is not null and disabled_at is null',
    [email]
  );
  const passwordOk = await verifyPassword(admin?.password_hash ?? (await dummyHash()), password);

  if (adminTotpEnabled() && admin?.totp_secret) {
    const step = matchTotpStep(unseal(admin.totp_secret), code);
    // A code is good once: a step at or before the last accepted one is refused, so an observed code cannot be replayed.
    const codeOk = step !== null && step > Number(admin.totp_last_step ?? 0);
    if (passwordOk && codeOk) {
      // Claim the step atomically: of two logins racing with the same code, only one updates the row.
      const claimed = await db.query('update admins set last_login_at = now(), totp_last_step = $2 where id = $1 and (totp_last_step is null or totp_last_step < $2) returning id', [admin.id, step]);
      if (claimed.length === 1) {
        await markAttemptSucceeded(db, attempt.id);
        return { ok: true, adminId: Number(admin.id) };
      }
    }
    return { ok: false, reason: 'invalid' };
  }

  if (!admin || !passwordOk) return { ok: false, reason: 'invalid' }; // the reserved row stays as the failure
  await markAttemptSucceeded(db, attempt.id); // the password was right; what follows has its own limits
  const adminId = Number(admin.id);
  if (trustedDevice && Number(known.id) === adminId) {
    await db.query('update admins set last_login_at = now() where id = $1', [adminId]);
    return { ok: true, adminId };
  }
  try {
    const issued = await issueLoginCode(db, adminId, admin.email, opts.codeDeps ? opts.codeDeps() : { mail: mailConfig() });
    return issued.ok ? { ok: false, reason: 'code-sent', challenge: issued.challenge } : { ok: false, reason: 'throttled' };
  } catch {
    return { ok: false, reason: 'mail-failed' }; // missing settings or Resend refused; nothing was kept
  }
}

/** Creates an admin with two-step verification on from the start. Returns the TOTP secret to show once. */
export async function createAdmin(db: Db, input: { name: string; email: string; password: string; role?: AdminRole }) {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email.');
  if (input.password.length < Math.max(MIN_PASSWORD, 12)) throw new Error('Admin passwords need at least 12 characters.');
  const secret = newTotpSecret();
  const [row] = await db.query<{ id: string }>('insert into admins (name, email, password_hash, totp_secret, role, totp_confirmed_at, activated_at) values ($1, $2, $3, $4, $5, now(), now()) returning id', [
    input.name.trim(),
    email,
    await hashPassword(input.password),
    seal(secret),
    input.role ?? 'staff',
  ]);
  return { adminId: Number(row.id), totpSecret: secret };
}

export type StudentProfile = { id: number; fullName: string; phone: string };
export async function getStudent(db: Db, id: number): Promise<StudentProfile | null> {
  const [r] = await db.query<{ id: string; full_name: string; phone: string }>('select id, full_name, phone from students where id = $1', [id]);
  return r ? { id: Number(r.id), fullName: r.full_name, phone: r.phone } : null;
}

export type AdminProfile = { id: number; name: string; role: AdminRole };
/** Only an active admin has a profile: a session of an admin who was disabled since, or reset to pending, is worth nothing. */
export async function getAdmin(db: Db, id: number): Promise<AdminProfile | null> {
  const [r] = await db.query<{ id: string; name: string; role: AdminRole }>('select id, name, role from admins where id = $1 and activated_at is not null and disabled_at is null', [id]);
  return r ? { id: Number(r.id), name: r.name, role: r.role } : null;
}
