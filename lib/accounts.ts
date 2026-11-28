import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { dummyHash, hashLoginCode, hashPassword, isThrottled, MIN_PASSWORD, newLoginCode, normalizeDigits, normalizeEmail, normalizePhone, recordAttempt, verifyPassword } from './auth';
import type { Db } from './db';
import { adminCodeMail, sendEmail, type Mailer } from './email';

/** Logging in: students by phone and password, admins by a six-digit code emailed to them. */

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
  if (await isThrottled(db, 'student', identifier, ip)) return { ok: false, reason: 'throttled' };

  const accounts = phone ? await db.query<{ id: string; full_name: string; password_hash: string }>('select id, full_name, password_hash from students where phone = $1 order by id limit $2', [phone, MAX_ACCOUNTS_PER_PHONE]) : [];
  const matches: { id: number; name: string }[] = [];
  if (accounts.length === 0) await verifyPassword(await dummyHash(), password); // same cost as a real check
  for (const a of accounts) {
    if (await verifyPassword(a.password_hash, password)) matches.push({ id: Number(a.id), name: a.full_name });
  }

  const chosen = matches.length === 1 ? matches[0] : matches.find((m) => m.name === fullName);
  if (chosen) {
    await recordAttempt(db, 'student', identifier, ip, true);
    return { ok: true, studentId: chosen.id };
  }
  if (matches.length > 1) return { ok: false, reason: 'choose', names: matches.map((m) => m.name) };
  await recordAttempt(db, 'student', identifier, ip, false);
  return { ok: false, reason: 'invalid' };
}

export type AdminLogin = { ok: true; adminId: number } | { ok: false; reason: LoginFailure };
export type CodeRequest = { ok: true } | { ok: false; reason: 'throttled' | 'send-failed' };

const CODE_TTL_MINUTES = 10;
const RESEND_AFTER_MS = 60_000; // a second press within the minute re-uses the code already on its way

/**
 * Sends a login code to an admin's address. An unknown address is answered the same way and
 * nothing is sent, so the form never reveals who is an admin.
 */
export async function requestAdminCode(db: Db, emailInput: string, ip: string, send: Mailer = sendEmail): Promise<CodeRequest> {
  const email = normalizeEmail(emailInput).slice(0, 200);
  if (await isThrottled(db, 'admin', email, ip)) return { ok: false, reason: 'throttled' };

  const [admin] = await db.query<{ id: string }>('select id from admins where lower(email) = $1', [email]);
  if (!admin) return { ok: true };

  await db.query(`delete from admin_login_codes where created_at < now() - interval '1 day'`);
  const [recent] = await db.query<{ created_at: Date }>(
    'select created_at from admin_login_codes where admin_id = $1 and consumed_at is null and expires_at > now() order by created_at desc limit 1',
    [admin.id]
  );
  if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_AFTER_MS) return { ok: true };

  const code = newLoginCode();
  // Only the newest code works: an older one left in an inbox stops being a way in.
  await db.query('delete from admin_login_codes where admin_id = $1 and consumed_at is null', [admin.id]);
  await db.query(`insert into admin_login_codes (admin_id, code_hash, expires_at) values ($1, $2, now() + interval '${CODE_TTL_MINUTES} minutes')`, [admin.id, hashLoginCode(code)]);
  try {
    await send({ to: email, ...adminCodeMail(code) });
  } catch {
    // The sender logs the reason. Drop the code so a failed send leaves nothing usable behind.
    await db.query('delete from admin_login_codes where admin_id = $1 and consumed_at is null', [admin.id]);
    return { ok: false, reason: 'send-failed' };
  }
  return { ok: true };
}

/** Checks an emailed code. A code is good once, for ten minutes, and only for the newest request. */
export async function verifyAdminCode(db: Db, emailInput: string, codeInput: string, ip: string): Promise<AdminLogin> {
  const email = normalizeEmail(emailInput).slice(0, 200);
  if (await isThrottled(db, 'admin', email, ip)) return { ok: false, reason: 'throttled' };

  const digits = normalizeDigits(codeInput);
  const [row] = await db.query<{ id: string; admin_id: string; code_hash: string }>(
    `select c.id, c.admin_id, c.code_hash from admin_login_codes c
     join admins a on a.id = c.admin_id
     where lower(a.email) = $1 and c.consumed_at is null and c.expires_at > now()
     order by c.created_at desc limit 1`,
    [email]
  );
  // Compare against a hash either way, so an unknown address and a wrong code take the same path.
  const given = Buffer.from(hashLoginCode(digits));
  const expected = Buffer.from(row?.code_hash ?? hashLoginCode('no-such-code'));
  const match = /^\d{6}$/.test(digits) && given.length === expected.length && timingSafeEqual(given, expected);

  if (row && match) {
    await db.query('update admin_login_codes set consumed_at = now() where id = $1', [row.id]);
    await db.query('update admins set last_login_at = now() where id = $1', [row.admin_id]);
    await recordAttempt(db, 'admin', email, ip, true);
    return { ok: true, adminId: Number(row.admin_id) };
  }
  await recordAttempt(db, 'admin', email, ip, false);
  return { ok: false, reason: 'invalid' };
}

/**
 * Creates an admin. The address is the whole credential: login is by a code sent to it.
 * Every admin is a super admin («مشرف عام», role `owner`) since migration 0006; `staff` stays in the type for old rows only.
 * A password may still be stored for an account that wants one, but nothing requires it.
 */
export async function createAdmin(db: Db, input: { name: string; email: string; password?: string; role?: 'owner' | 'staff' }) {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email.');
  if (input.password !== undefined && input.password.length < Math.max(MIN_PASSWORD, 12)) throw new Error('Admin passwords need at least 12 characters.');
  const [row] = await db.query<{ id: string }>('insert into admins (name, email, password_hash, role) values ($1, $2, $3, $4) returning id', [
    input.name.trim(),
    email,
    input.password === undefined ? null : await hashPassword(input.password),
    input.role ?? 'owner',
  ]);
  return { adminId: Number(row.id) };
}

export type StudentProfile = { id: number; fullName: string; phone: string };
export async function getStudent(db: Db, id: number): Promise<StudentProfile | null> {
  const [r] = await db.query<{ id: string; full_name: string; phone: string }>('select id, full_name, phone from students where id = $1', [id]);
  return r ? { id: Number(r.id), fullName: r.full_name, phone: r.phone } : null;
}

export type AdminProfile = { id: number; name: string; role: 'owner' | 'staff' };
export async function getAdmin(db: Db, id: number): Promise<AdminProfile | null> {
  const [r] = await db.query<{ id: string; name: string; role: 'owner' | 'staff' }>('select id, name, role from admins where id = $1', [id]);
  return r ? { id: Number(r.id), name: r.name, role: r.role } : null;
}
