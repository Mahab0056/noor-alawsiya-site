import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { audit } from './admin';
import { normalizeEmail } from './auth';
import type { Db } from './db';
import { inviteEmail, sendMail, type Fetch, type MailConfig } from './mail';

/**
 * Admin invitations and the super-admin actions on other admins.
 *
 * Sign-in is by a six-digit code e-mailed to the admin (lib/accounts.ts, live since PR #10): no password, no app.
 * An invited admin is "pending" (activated_at null) and gets no login code. The invite link carries a random token
 * (32 bytes); only its sha256 is stored. A token works once, for INVITE_HOURS, and any newer invite for the same admin
 * revokes it. Accepting on /admin/invite/<token>: write a name, and the admin is active and signed in. The link reached
 * the admin's mailbox, which is the same proof a login code gives.
 *
 * Every change is in audit_log by reference only (admin:<id>, invite:<id>): never an address, never a token.
 */

export const INVITE_HOURS = 48;
const MAX_FAILS_PER_IP = 20; // per 15 minutes, as for logins
const MAX_FAILS_PER_INVITE = 5; // failed attempts on one invite, per 15 minutes
const WINDOW = '15 minutes';

export type AdminRole = 'super_admin' | 'owner' | 'staff';
export type InviteRole = 'super_admin' | 'staff';

export class InviteError extends Error {
  constructor(
    public code: 'not-super' | 'bad-email' | 'already-active' | 'self' | 'not-found' | 'not-pending',
    message: string
  ) {
    super(message);
  }
}

class StateChanged extends Error {}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url

/** The actor must be an active super admin. Checked again here, whatever the caller already checked. */
async function assertSuperAdmin(db: Db, actorId: number) {
  const [row] = await db.query<{ ok: boolean }>(
    `select (role = 'super_admin' and activated_at is not null and disabled_at is null) as ok from admins where id = $1`,
    [actorId]
  );
  if (!row?.ok) throw new InviteError('not-super', 'Only a super admin can do this.');
}

// ---------------------------------------------------------------- issuing invites

export type InviteDeps = { mail: MailConfig; fetchImpl?: Fetch };

/**
 * Creates (or re-issues) an invite and sends it. Everything runs in one transaction that includes the send:
 * if Resend refuses, nothing is kept. `actorId` null means the operator command (create-admin --invite).
 * `reset` lets an existing active admin be invited again: their sessions and login codes end until they accept the new link.
 */
export async function inviteAdmin(db: Db, input: { email: string; role: InviteRole; actorId: number | null; reset?: boolean }, deps: InviteDeps) {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw new InviteError('bad-email', 'Invalid email.');
  if (input.actorId !== null) await assertSuperAdmin(db, input.actorId);

  return db.tx(async (t) => {
    const [existing] = await t.query<{ id: string; confirmed: boolean }>(
      'select id, (activated_at is not null) as confirmed from admins where lower(email) = $1 for update',
      [email]
    );
    let adminId: number;
    if (!existing) {
      const [row] = await t.query<{ id: string }>(`insert into admins (name, email, role, invited_by) values ('', $1, $2, $3) returning id`, [email, input.role, input.actorId]);
      adminId = Number(row.id);
    } else {
      adminId = Number(existing.id);
      if (adminId === input.actorId) throw new InviteError('self', 'You cannot re-invite yourself.');
      if (existing.confirmed && !input.reset) throw new InviteError('already-active', 'This admin is already active. Use --reset to invite them again: their sessions and login codes end, and they cannot sign in until they accept the new link.');
      await resetToPending(t, adminId, input.role);
    }
    return issue(t, adminId, input.role, input.actorId, existing ? (existing.confirmed ? 'admin.reinvite' : 'admin.invite.resend') : 'admin.invite', email, deps);
  });
}

/**
 * A super admin sends a fresh link to a pending admin (the old link stops working). With `reset`, also to an active
 * admin (a changed or compromised mailbox): their sessions and login codes end until they accept the new link.
 */
export async function resendInvite(db: Db, actorId: number, adminId: number, deps: InviteDeps, opts: { reset?: boolean } = {}) {
  await assertSuperAdmin(db, actorId);
  if (adminId === actorId) throw new InviteError('self', 'You cannot re-invite yourself.');
  return db.tx(async (t) => {
    const [a] = await t.query<{ email: string; role: AdminRole; confirmed: boolean }>(
      'select email, role, (activated_at is not null) as confirmed from admins where id = $1 for update',
      [adminId]
    );
    if (!a) throw new InviteError('not-found', 'No such admin.');
    if (a.confirmed && !opts.reset) throw new InviteError('not-pending', 'This admin is already active.');
    const role: InviteRole = a.role === 'super_admin' ? 'super_admin' : 'staff';
    await resetToPending(t, adminId, role);
    return issue(t, adminId, role, actorId, a.confirmed ? 'admin.reinvite' : 'admin.invite.resend', a.email, deps);
  });
}

async function resetToPending(t: Db, adminId: number, role: InviteRole) {
  await t.query(
    `update admins set role = $2, password_hash = null, totp_secret = null, totp_last_step = null, activated_at = null, disabled_at = null where id = $1`,
    [adminId, role]
  );
  await t.query('delete from sessions where admin_id = $1', [adminId]);
  await forgetCodes(t, adminId);
}

/** Open login codes of an admin stop working (disable, re-invite). */
const forgetCodes = (t: Db, adminId: number) => t.query('delete from admin_login_codes where admin_id = $1', [adminId]);

async function issue(t: Db, adminId: number, role: InviteRole, actorId: number | null, action: string, email: string, deps: InviteDeps) {
  await t.query('update admin_invites set revoked_at = now() where admin_id = $1 and used_at is null and revoked_at is null', [adminId]);
  const token = randomBytes(32).toString('base64url');
  const [row] = await t.query<{ id: string }>(
    `insert into admin_invites (admin_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() + interval '${INVITE_HOURS} hours') returning id`,
    [adminId, sha256(token), actorId]
  );
  const inviteId = Number(row.id);
  await audit(t, actorId, action, `admin:${adminId}`, { invite: inviteId, role });
  const link = `${deps.mail.origin}/admin/invite/${token}`;
  await sendMail(deps.mail, { to: email, ...inviteEmail(link, role === 'super_admin' ? 'super_admin' : 'admin', INVITE_HOURS) }, deps.fetchImpl);
  return { adminId, inviteId };
}

// ---------------------------------------------------------------- super-admin actions on other admins

export async function revokeInvite(db: Db, actorId: number, adminId: number) {
  await assertSuperAdmin(db, actorId);
  await db.tx(async (t) => {
    const rows = await t.query<{ id: string }>('update admin_invites set revoked_at = now() where admin_id = $1 and used_at is null and revoked_at is null returning id', [adminId]);
    for (const r of rows) await audit(t, actorId, 'admin.invite.revoke', `admin:${adminId}`, { invite: Number(r.id) });
  });
}

/** Disabling ends the admin's sessions at once and stops logins. An admin cannot disable themselves. */
export async function setAdminDisabled(db: Db, actorId: number, adminId: number, disabled: boolean) {
  await assertSuperAdmin(db, actorId);
  if (adminId === actorId) throw new InviteError('self', 'You cannot disable yourself.');
  await db.tx(async (t) => {
    const rows = await t.query('update admins set disabled_at = $2 where id = $1 returning id', [adminId, disabled ? new Date() : null]);
    if (rows.length === 0) throw new InviteError('not-found', 'No such admin.');
    if (disabled) {
      await t.query('delete from sessions where admin_id = $1', [adminId]);
      await forgetCodes(t, adminId);
      await t.query('update admin_invites set revoked_at = now() where admin_id = $1 and used_at is null and revoked_at is null', [adminId]);
    }
    await audit(t, actorId, disabled ? 'admin.disable' : 'admin.enable', `admin:${adminId}`);
  });
}

/**
 * Clears the recent failed sign-ins for another admin's e-mail, so a locked-out admin can try again at once
 * instead of waiting the 15 minutes. It does not touch the per-address limit.
 */
export async function unlockAdmin(db: Db, actorId: number, adminId: number) {
  await assertSuperAdmin(db, actorId);
  await db.tx(async (t) => {
    const [a] = await t.query<{ email: string }>('select email from admins where id = $1', [adminId]);
    if (!a) throw new InviteError('not-found', 'No such admin.');
    await t.query(`delete from login_attempts where scope = 'admin' and identifier = $1 and not succeeded`, [normalizeEmail(a.email)]);
    await audit(t, actorId, 'admin.unlock', `admin:${adminId}`);
  });
}

export type AdminListRow = {
  id: number; name: string; email: string; role: AdminRole;
  status: 'active' | 'pending' | 'disabled'; locked: boolean; inviteExpiresAt: Date | null;
};

export async function listAdmins(db: Db): Promise<AdminListRow[]> {
  const rows = await db.query<{ id: string; name: string; email: string; role: AdminRole; confirmed: boolean; disabled: boolean; fails: string; invite_expires_at: Date | null }>(
    `select a.id, a.name, a.email, a.role, (a.activated_at is not null) as confirmed, (a.disabled_at is not null) as disabled,
            (select count(*) from login_attempts l where l.scope = 'admin' and l.identifier = lower(a.email) and not l.succeeded and l.created_at > now() - interval '${WINDOW}') as fails,
            (select i.expires_at from admin_invites i where i.admin_id = a.id and i.used_at is null and i.revoked_at is null) as invite_expires_at
     from admins a order by a.id`
  );
  return rows.map((r) => ({
    id: Number(r.id), name: r.name, email: r.email, role: r.role,
    status: r.disabled ? 'disabled' : r.confirmed ? 'active' : 'pending',
    locked: Number(r.fails) > 0,
    inviteExpiresAt: r.invite_expires_at ? new Date(r.invite_expires_at) : null,
  }));
}

// ---------------------------------------------------------------- accepting an invite (no session; the token is the credential)

type OpenInvite = { inviteId: number; adminId: number; email: string };

async function findInvite(db: Db, token: string): Promise<OpenInvite | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [r] = await db.query<{ id: string; admin_id: string; email: string }>(
    `select i.id, i.admin_id, a.email
     from admin_invites i join admins a on a.id = i.admin_id
     where i.token_hash = $1 and i.used_at is null and i.revoked_at is null and i.expires_at > now()
       and a.activated_at is null and a.disabled_at is null`,
    [sha256(token)]
  );
  return r ? { inviteId: Number(r.id), adminId: Number(r.admin_id), email: r.email } : null;
}

/**
 * Atomic check-and-reserve: under a lock on the address, count recent failures (by address, and by invite when it is
 * known) and, if under the limits, write this attempt as a failure before anything is checked. The caller marks it
 * succeeded afterwards. Parallel requests queue on the lock, so a burst cannot get past the limit.
 */
async function reserve(db: Db, ip: string, inviteId: number | null): Promise<{ id: number; throttled: boolean }> {
  await db.query(`delete from invite_attempts where created_at < now() - interval '1 day'`);
  return db.tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock(4, hashtext($1))`, [ip]);
    const [row] = await t.query<{ by_ip: string; by_invite: string }>(
      `select count(*) filter (where ip = $1) as by_ip, count(*) filter (where invite_id = $2) as by_invite
       from invite_attempts where not succeeded and created_at > now() - interval '${WINDOW}' and (ip = $1 or invite_id = $2)`,
      [ip, inviteId]
    );
    if (Number(row.by_ip) >= MAX_FAILS_PER_IP || Number(row.by_invite) >= MAX_FAILS_PER_INVITE) return { id: 0, throttled: true };
    const [{ id }] = await t.query<{ id: string }>('insert into invite_attempts (ip, invite_id) values ($1, $2) returning id', [ip, inviteId]);
    return { id: Number(id), throttled: false };
  });
}
const succeeded = (db: Db, id: number) => db.query('update invite_attempts set succeeded = true where id = $1', [id]);

export type InviteFailure = 'invalid' | 'throttled';
export type InviteView = { ok: true; email: string } | { ok: false; reason: InviteFailure };

/** What the invite page shows. An unknown, used, expired, revoked or malformed token all look the same. */
export async function viewInvite(db: Db, token: string, ip: string): Promise<InviteView> {
  const invite = await findInvite(db, token);
  const attempt = await reserve(db, ip, invite?.inviteId ?? null);
  if (attempt.throttled) return { ok: false, reason: 'throttled' };
  if (!invite) return { ok: false, reason: 'invalid' };
  await succeeded(db, attempt.id);
  return { ok: true, email: invite.email };
}

export type AcceptStep = { ok: true; adminId: number } | { ok: false; reason: InviteFailure } | { ok: false; reason: 'form'; errors: { name?: string } };

/** The only step: a name. The invite is used and the admin is active and signed in; later sign-ins get a code by e-mail. */
export async function acceptInvite(db: Db, token: string, input: { name: string }, ip: string): Promise<AcceptStep> {
  const invite = await findInvite(db, token);
  const attempt = await reserve(db, ip, invite?.inviteId ?? null);
  if (attempt.throttled) return { ok: false, reason: 'throttled' };
  if (!invite) return { ok: false, reason: 'invalid' };
  await succeeded(db, attempt.id); // the token was right; form errors below are not guesses

  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 80) return { ok: false, reason: 'form', errors: { name: 'اكتب اسمك كما يظهر لبقية المشرفين.' } };

  const done = await db.tx(async (t) => {
    // Claim the invite: of two submits racing, only one finds it unused.
    const used = await t.query('update admin_invites set used_at = now() where id = $1 and used_at is null and revoked_at is null and expires_at > now() returning id', [invite.inviteId]);
    if (used.length !== 1) return false;
    const rows = await t.query(
      'update admins set name = $2, activated_at = now(), last_login_at = now() where id = $1 and activated_at is null and disabled_at is null returning id',
      [invite.adminId, name]
    );
    if (rows.length !== 1) throw new StateChanged(); // rolls the claim back
    await audit(t, invite.adminId, 'admin.invite.accept', `admin:${invite.adminId}`, { invite: invite.inviteId });
    return true;
  }).catch((e) => {
    if (e instanceof StateChanged) return false;
    throw e;
  });
  return done ? { ok: true, adminId: invite.adminId } : { ok: false, reason: 'invalid' };
}
