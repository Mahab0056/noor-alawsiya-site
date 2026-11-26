import 'server-only';
import { createAdmin } from './accounts';
import { normalizeEmail } from './auth';
import type { Db } from './db';

/**
 * The admin team. Every admin is a super admin («مشرف عام»): each one can add and remove the others.
 * Callers must have checked the admin session first (see lib/session.ts requireAdmin).
 * The audit log keeps the admin's id only, never the address.
 */

export type TeamMember = { id: number; name: string; email: string; createdAt: Date; lastLoginAt: Date | null };

export class TeamError extends Error {
  constructor(public code: 'name' | 'email' | 'exists' | 'self' | 'last') {
    super(code);
  }
}

async function audit(db: Db, adminId: number, action: string, target: string) {
  await db.query('insert into audit_log (admin_id, action, target) values ($1, $2, $3)', [adminId, action, target]);
}

export async function listTeam(db: Db): Promise<TeamMember[]> {
  const rows = await db.query<{ id: string; name: string; email: string; created_at: Date; last_login_at: Date | null }>(
    'select id, name, email, created_at, last_login_at from admins order by created_at, id'
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, email: r.email, createdAt: new Date(r.created_at), lastLoginAt: r.last_login_at ? new Date(r.last_login_at) : null }));
}

/** Adds a super admin. The address is the whole credential: the login code is sent to it. */
export async function addTeamMember(db: Db, actorId: number, input: { name: string; email: string }) {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (name.length < 2 || name.length > 80) throw new TeamError('name');
  if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new TeamError('email');
  return db.tx(async (t) => {
    const taken = await t.query('select 1 from admins where lower(email) = $1', [email]);
    if (taken.length) throw new TeamError('exists');
    const { adminId } = await createAdmin(t, { name, email, role: 'owner' });
    await audit(t, actorId, 'admin.add', `admin:${adminId}`);
    return adminId;
  });
}

/** Removes an admin and ends their sessions. Nobody removes themselves, so the panel is never left with no admin. */
export async function removeTeamMember(db: Db, actorId: number, id: number) {
  if (id === actorId) throw new TeamError('self');
  await db.tx(async (t) => {
    const [{ n }] = await t.query<{ n: number }>('select count(*)::int as n from admins');
    if (n <= 1) throw new TeamError('last');
    const rows = await t.query('delete from admins where id = $1 returning id', [id]);
    if (rows.length) await audit(t, actorId, 'admin.remove', `admin:${id}`);
  });
}
