import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getAdmin, getStudent, type AdminProfile, type StudentProfile } from './accounts';
import { createSession, destroySession, readSession, type SessionKind } from './auth';
import { pickClientIp } from './client-ip';
import { SESSION_COOKIE } from './cookie-names';
import { getDb } from './db';

/**
 * Session cookies. Every page and every Server Action that touches private data calls
 * requireStudent() or requireAdmin() itself; nothing relies on a layout or on the proxy.
 */

const COOKIE: Record<SessionKind, string> = SESSION_COOKIE;

export async function startSession(kind: SessionKind, userId: number) {
  const db = await getDb();
  const { token, expiresAt } = await createSession(db, kind, userId);
  (await cookies()).set(COOKIE[kind], token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(kind: SessionKind) {
  const store = await cookies();
  await destroySession(await getDb(), store.get(COOKIE[kind])?.value);
  store.delete(COOKIE[kind]);
}

async function currentUserId(kind: SessionKind) {
  // Sessions are per request. Saying so explicitly keeps this out of any prerender, whatever database driver is in use
  // (the in-process development database answers without network I/O, which Next would otherwise treat as static).
  await connection();
  const token = (await cookies()).get(COOKIE[kind])?.value;
  const session = await readSession(await getDb(), token);
  return session?.kind === kind ? session.userId : null;
}

// React cache: one lookup per render pass. It does nothing inside Server Actions, which is fine.
export const currentStudent = cache(async (): Promise<StudentProfile | null> => {
  const id = await currentUserId('student');
  return id ? getStudent(await getDb(), id) : null;
});

export const currentAdmin = cache(async (): Promise<AdminProfile | null> => {
  const id = await currentUserId('admin');
  return id ? getAdmin(await getDb(), id) : null;
});

export async function requireStudent() {
  return (await currentStudent()) ?? redirect('/login');
}

export async function requireAdmin() {
  return (await currentAdmin()) ?? redirect('/admin/login');
}

/** For every super-admin page and Server Action. lib/invites.ts checks the role again against the database. */
export async function requireSuperAdmin() {
  const admin = await requireAdmin();
  return admin.role === 'super_admin' ? admin : redirect('/admin');
}

/**
 * Client address for throttling. Railway documents X-Real-IP as the client's address, set by its edge. Because that
 * cannot be proven from here, the value is only used when it parses as an IP address (anything else, e.g. a long
 * random string meant to make a fresh bucket each time, is ignored), and the limits that matter most do not depend on
 * it alone: students are limited per phone from every address, admins also per e-mail from every address
 * (lib/auth.ts), and an admin sign-in needs a code sent by e-mail. X-Forwarded-For can carry client values; only its
 * last hop (added by the nearest proxy) is used, as a fallback.
 */
export async function clientIp() {
  const h = await headers();
  return pickClientIp(h.get('x-real-ip'), h.get('x-forwarded-for'));
}
