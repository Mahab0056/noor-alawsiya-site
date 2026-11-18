import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getAdmin, getStudent, type AdminProfile, type StudentProfile } from './accounts';
import { createSession, destroySession, readSession, type SessionKind } from './auth';
import { getDb } from './db';

/**
 * Session cookies. Every page and every Server Action that touches private data calls
 * requireStudent() or requireAdmin() itself; nothing relies on a layout or on the proxy.
 */

const COOKIE: Record<SessionKind, string> = { student: 'noor_s', admin: 'noor_a' };

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

/** Client address for login throttling. Railway and most proxies put the client first in x-forwarded-for. */
export async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}
