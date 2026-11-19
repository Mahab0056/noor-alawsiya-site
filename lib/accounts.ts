import 'server-only';
import { dummyHash, hashPassword, markAttemptSucceeded, MIN_PASSWORD, newTotpSecret, normalizeEmail, normalizePhone, reserveAttempt, seal, unseal, matchTotpStep, verifyPassword } from './auth';
import type { Db } from './db';
import type { AdminRole } from './invites';

/** Logging in: students by phone and password, admins by email, password and a TOTP code. */

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

export type AdminLogin = { ok: true; adminId: number } | { ok: false; reason: LoginFailure };

/** Password and TOTP are checked together and fail the same way, so a wrong code does not confirm the password. */
export async function loginAdmin(db: Db, emailInput: string, password: string, code: string, ip: string): Promise<AdminLogin> {
  const email = normalizeEmail(emailInput).slice(0, 200);
  const attempt = await reserveAttempt(db, 'admin', email, ip);
  if (attempt.throttled) return { ok: false, reason: 'throttled' };

  const [admin] = await db.query<{ id: string; password_hash: string; totp_secret: string | null; totp_last_step: string | null }>(
    // Only active admins: a pending admin (invited, authenticator not confirmed yet) or a disabled one cannot sign in.
    'select id, password_hash, totp_secret, totp_last_step from admins where lower(email) = $1 and totp_confirmed_at is not null and disabled_at is null',
    [email]
  );
  const passwordOk = await verifyPassword(admin?.password_hash ?? (await dummyHash()), password);
  const step = admin?.totp_secret ? matchTotpStep(unseal(admin.totp_secret), code) : null;
  // A code is good once: a step at or before the last accepted one is refused, so an observed code cannot be replayed.
  const codeOk = step !== null && step > Number(admin?.totp_last_step ?? 0);
  if (admin && passwordOk && codeOk) {
    // Claim the step atomically: of two logins racing with the same code, only one updates the row.
    const claimed = await db.query('update admins set last_login_at = now(), totp_last_step = $2 where id = $1 and (totp_last_step is null or totp_last_step < $2) returning id', [admin.id, step]);
    if (claimed.length === 1) {
      await markAttemptSucceeded(db, attempt.id);
      return { ok: true, adminId: Number(admin.id) };
    }
  }
  return { ok: false, reason: 'invalid' }; // the reserved row stays as the failure
}

/** Creates an admin with two-step verification on from the start. Returns the TOTP secret to show once. */
export async function createAdmin(db: Db, input: { name: string; email: string; password: string; role?: AdminRole }) {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email.');
  if (input.password.length < Math.max(MIN_PASSWORD, 12)) throw new Error('Admin passwords need at least 12 characters.');
  const secret = newTotpSecret();
  const [row] = await db.query<{ id: string }>('insert into admins (name, email, password_hash, totp_secret, role, totp_confirmed_at) values ($1, $2, $3, $4, $5, now()) returning id', [
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
  const [r] = await db.query<{ id: string; name: string; role: AdminRole }>('select id, name, role from admins where id = $1 and totp_confirmed_at is not null and disabled_at is null', [id]);
  return r ? { id: Number(r.id), name: r.name, role: r.role } : null;
}
