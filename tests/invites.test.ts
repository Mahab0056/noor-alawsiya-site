// Admin invitations on an in-memory PGlite database, with a local stand-in for Resend. Invented data only:
// no real address, no real key, and no e-mail ever leaves this process.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';
import { createAdmin, getAdmin, loginAdmin } from '@/lib/accounts';
import { createSession, readSession, totpAt } from '@/lib/auth';
import { resetDbForTests, type Db } from '@/lib/db';
import { confirmInviteTotp, InviteError, inviteAdmin, listAdmins, resendInvite, revokeInvite, setAdminDisabled, setInvitePassword, unlockAdmin, viewInvite } from '@/lib/invites';
import { appOrigin, DEFAULT_MAIL_FROM, INVITE_SUBJECT, MailConfigError, mailConfig, RESEND_ENDPOINT, type Fetch, type MailConfig } from '@/lib/mail';

// These tests cover the authenticator-app path, kept behind ADMIN_TOTP=1 (lib/flags.ts). The default e-mail-code
// path is in tests/email-codes.test.ts. Read at call time, so setting it here is enough.
process.env.ADMIN_TOTP = '1';

let db: Db;
let superId: number;
let staffId: number;
const IP = '10.1.0.1';
const ORIGIN = 'https://noor-alawsiya.test';
const FAKE_KEY = 're_test_not_a_real_key_000000';
const mail: MailConfig = mailConfig({ RESEND_API_KEY: FAKE_KEY, APP_ORIGIN: ORIGIN });

// ---------------------------------------------------------------- local Resend stand-in

type Sent = { url: string; headers: Record<string, string>; body: { from: string; to: string[]; subject: string; text: string; html: string } };
let outbox: Sent[] = [];
const everyToken: string[] = [];
let resendStatus = 200;
const stub: Fetch = async (url, init) => {
  const body = JSON.parse(String(init.body));
  outbox.push({ url, headers: init.headers as Record<string, string>, body });
  everyToken.push(body.text.match(/\/admin\/invite\/([A-Za-z0-9_-]+)/)[1]);
  return new Response('{"id":"stub"}', { status: resendStatus });
};
const deps = { mail, fetchImpl: stub };
const lastToken = () => {
  const m = outbox.at(-1)!.body.text.match(/\/admin\/invite\/([A-Za-z0-9_-]+)/);
  return m![1];
};

// Everything printed during these tests, to prove no token or address is ever logged.
const printed: string[] = [];
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };

before(async () => {
  db = await resetDbForTests();
  superId = (await createAdmin(db, { name: 'مدير أعلى تجريبي', email: 'super@example.test', password: 'a-long-test-password', role: 'super_admin' })).adminId;
  staffId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'staff@example.test', password: 'a-long-test-password', role: 'staff' })).adminId;
  for (const k of ['log', 'info', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => void printed.push(a.map(String).join(' '));
});
after(async () => {
  Object.assign(console, original);
  await db.close();
});
beforeEach(() => {
  outbox = [];
  resendStatus = 200;
});
afterEach(async () => {
  await db.query('delete from invite_attempts');
  await db.query('delete from login_attempts');
});

const countAdmins = async () => Number((await db.query<{ n: string }>('select count(*) as n from admins'))[0].n);

// ---------------------------------------------------------------- the whole flow

test('invite → open link → set password → confirm a TOTP code → signed in; then normal login works', async () => {
  const { adminId, inviteId } = await inviteAdmin(db, { email: 'New.Admin@Example.test', role: 'super_admin', actorId: superId }, deps);
  assert.equal(outbox.length, 1);
  const sent = outbox[0];
  assert.equal(sent.url, RESEND_ENDPOINT);
  assert.equal(sent.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(sent.body.from, DEFAULT_MAIL_FROM);
  assert.deepEqual(sent.body.to, ['new.admin@example.test']);
  assert.equal(sent.body.subject, INVITE_SUBJECT);
  assert.match(sent.body.html, /<html lang="ar" dir="rtl">/);
  assert.ok(sent.body.text.includes(`${ORIGIN}/admin/invite/`), 'plain-text part carries the link');
  const token = lastToken();
  assert.equal(Buffer.from(token, 'base64url').length, 32, 'token is 32 random bytes');

  const [stored] = await db.query<{ token_hash: string }>('select token_hash from admin_invites where id = $1', [inviteId]);
  assert.notEqual(stored.token_hash, token);
  assert.ok(!stored.token_hash.includes(token));

  assert.deepEqual(await viewInvite(db, token, IP), { ok: true, email: 'new.admin@example.test', step: 'password' });
  assert.equal(await getAdmin(db, adminId), null, 'a pending admin has no profile, so no session can use it');

  const bad = await setInvitePassword(db, token, { name: 'مد', password: 'short', confirm: 'short' }, IP);
  assert.ok(!bad.ok && bad.reason === 'form' && bad.errors.name && bad.errors.password);
  const mismatch = await setInvitePassword(db, token, { name: 'مدير جديد', password: 'new-admin-password', confirm: 'other-password!!' }, IP);
  assert.ok(!mismatch.ok && mismatch.reason === 'form' && mismatch.errors.password);

  const step1 = await setInvitePassword(db, token, { name: 'مدير جديد', password: 'new-admin-password', confirm: 'new-admin-password' }, IP);
  assert.ok(step1.ok && !step1.activated);
  assert.match(step1.uri, /^otpauth:\/\/totp\//);
  const [row] = await db.query<{ password_hash: string; totp_secret: string | null; totp_pending_secret: string }>('select password_hash, totp_secret, totp_pending_secret from admins where id = $1', [adminId]);
  assert.match(row.password_hash, /^\$argon2id\$/);
  assert.equal(row.totp_secret, null, 'the secret is not kept before a code confirms it');
  assert.ok(!row.totp_pending_secret.includes(step1.secret), 'the proposed secret is encrypted at rest');

  // Until a code is confirmed, password + a valid code still cannot sign in.
  const now = Date.now();
  assert.deepEqual(await loginAdmin(db, 'new.admin@example.test', 'new-admin-password', totpAt(step1.secret, now), IP), { ok: false, reason: 'invalid' });

  assert.deepEqual(await confirmInviteTotp(db, token, '000000', IP, now), { ok: false, reason: 'code' });
  const done = await confirmInviteTotp(db, token, totpAt(step1.secret, now), IP, now);
  assert.deepEqual(done, { ok: true, adminId });
  assert.deepEqual(await getAdmin(db, adminId), { id: adminId, name: 'مدير جديد', role: 'super_admin' });

  // The same code cannot be used again to log in; the next one can.
  assert.deepEqual(await loginAdmin(db, 'new.admin@example.test', 'new-admin-password', totpAt(step1.secret, now), IP), { ok: false, reason: 'invalid' });
  assert.ok((await loginAdmin(db, 'new.admin@example.test', 'new-admin-password', totpAt(step1.secret, now + 30_000), IP)).ok);
});

test('a used token cannot be used again', async () => {
  const { adminId } = await inviteAdmin(db, { email: 'reuse@example.test', role: 'staff', actorId: superId }, deps);
  const token = lastToken();
  const s = await setInvitePassword(db, token, { name: 'مشرف ثانٍ', password: 'reuse-admin-password', confirm: 'reuse-admin-password' }, IP);
  assert.ok(s.ok && !s.activated);
  assert.ok((await confirmInviteTotp(db, token, totpAt(s.secret, Date.now()), IP)).ok);
  assert.deepEqual(await viewInvite(db, token, IP), { ok: false, reason: 'invalid' });
  assert.deepEqual(await setInvitePassword(db, token, { name: 'مهاجم', password: 'attacker-password', confirm: 'attacker-password' }, IP), { ok: false, reason: 'invalid' });
  assert.deepEqual(await confirmInviteTotp(db, token, totpAt(s.secret, Date.now() + 30_000), IP), { ok: false, reason: 'invalid' });
  assert.equal((await getAdmin(db, adminId))?.name, 'مشرف ثانٍ', 'the account was not changed by the second use');
});

test('an expired token is refused with the same neutral answer', async () => {
  const { inviteId } = await inviteAdmin(db, { email: 'late@example.test', role: 'staff', actorId: superId }, deps);
  const token = lastToken();
  await db.query(`update admin_invites set created_at = now() - interval '49 hours', expires_at = now() - interval '1 hour' where id = $1`, [inviteId]);
  assert.deepEqual(await viewInvite(db, token, IP), { ok: false, reason: 'invalid' });
  assert.deepEqual(await setInvitePassword(db, token, { name: 'متأخر', password: 'late-admin-password', confirm: 'late-admin-password' }, IP), { ok: false, reason: 'invalid' });
});

test('invites expire after 48 hours', async () => {
  const { inviteId } = await inviteAdmin(db, { email: 'hours@example.test', role: 'staff', actorId: superId }, deps);
  const [r] = await db.query<{ h: string }>('select extract(epoch from expires_at - created_at) / 3600 as h from admin_invites where id = $1', [inviteId]);
  assert.equal(Math.round(Number(r.h)), 48);
});

test('a newer invite makes the older link useless; a revoked invite too', async () => {
  const { adminId } = await inviteAdmin(db, { email: 'twice@example.test', role: 'staff', actorId: superId }, deps);
  const first = lastToken();
  await resendInvite(db, superId, adminId, deps);
  const second = lastToken();
  assert.notEqual(first, second);
  assert.deepEqual(await viewInvite(db, first, IP), { ok: false, reason: 'invalid' });
  assert.equal((await viewInvite(db, second, IP)).ok, true);
  // the operator command on the same address also replaces it
  await inviteAdmin(db, { email: 'TWICE@example.test', role: 'staff', actorId: null }, deps);
  const third = lastToken();
  assert.deepEqual(await viewInvite(db, second, IP), { ok: false, reason: 'invalid' });
  await revokeInvite(db, superId, adminId);
  assert.deepEqual(await viewInvite(db, third, IP), { ok: false, reason: 'invalid' });
  assert.equal((await listAdmins(db)).find((a) => a.id === adminId)?.inviteExpiresAt, null);
});

test('a tampered or malformed token is refused the same way', async () => {
  await inviteAdmin(db, { email: 'tamper@example.test', role: 'staff', actorId: superId }, deps);
  const token = lastToken();
  const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
  for (const t of [flipped, token.slice(0, -1), `${token}A`, '', '../../etc/passwd', token.toUpperCase() === token ? token.toLowerCase() : token.toUpperCase()]) {
    assert.deepEqual(await viewInvite(db, t, IP), { ok: false, reason: 'invalid' }, `refused: ${t.length} chars`);
  }
  assert.equal((await viewInvite(db, token, IP)).ok, true, 'the real one still works');
});

test('an admin who is not a super admin cannot invite, resend, revoke, disable or unlock', async () => {
  const before = await countAdmins();
  await assert.rejects(inviteAdmin(db, { email: 'nope@example.test', role: 'super_admin', actorId: staffId }, deps), (e: InviteError) => e.code === 'not-super');
  await assert.rejects(resendInvite(db, staffId, superId, deps), (e: InviteError) => e.code === 'not-super');
  await assert.rejects(revokeInvite(db, staffId, superId), (e: InviteError) => e.code === 'not-super');
  await assert.rejects(setAdminDisabled(db, staffId, superId, true), (e: InviteError) => e.code === 'not-super');
  await assert.rejects(unlockAdmin(db, staffId, superId), (e: InviteError) => e.code === 'not-super');
  assert.equal(await countAdmins(), before);
  assert.equal(outbox.length, 0, 'nothing was sent');
  assert.equal((await getAdmin(db, superId))?.role, 'super_admin');
});

test('a pending admin cannot sign in, before or after setting a password', async () => {
  const { adminId } = await inviteAdmin(db, { email: 'pending@example.test', role: 'staff', actorId: superId }, deps);
  const token = lastToken();
  assert.deepEqual(await loginAdmin(db, 'pending@example.test', '', '000000', IP), { ok: false, reason: 'invalid' });
  const s = await setInvitePassword(db, token, { name: 'مشرف معلّق', password: 'pending-admin-pass', confirm: 'pending-admin-pass' }, IP);
  assert.ok(s.ok && !s.activated);
  assert.deepEqual(await loginAdmin(db, 'pending@example.test', 'pending-admin-pass', totpAt(s.secret, Date.now()), IP), { ok: false, reason: 'invalid' });
  // even a session row made by hand for them is worth nothing
  const { token: sessionToken } = await createSession(db, 'admin', adminId);
  assert.equal((await readSession(db, sessionToken))?.userId, adminId);
  assert.equal(await getAdmin(db, adminId), null);
});

test('missing or bad mail settings: the error names the variable, and nothing is created', async () => {
  assert.throws(() => mailConfig({ APP_ORIGIN: ORIGIN }), (e: Error) => e instanceof MailConfigError && /RESEND_API_KEY is not set/.test(e.message));
  assert.throws(() => mailConfig({ RESEND_API_KEY: 'sk_live_something', APP_ORIGIN: ORIGIN }), MailConfigError);
  assert.throws(() => mailConfig({ RESEND_API_KEY: FAKE_KEY }), /APP_ORIGIN is not set/);
  assert.throws(() => mailConfig({ RESEND_API_KEY: FAKE_KEY, APP_ORIGIN: ORIGIN, MAIL_FROM: 'not an address' }), /MAIL_FROM/);
  assert.equal(mailConfig({ RESEND_API_KEY: FAKE_KEY, APP_ORIGIN: ORIGIN, MAIL_FROM: 'نور الأوصياء <no-reply@noor-alawsiya.com>' }).from, 'نور الأوصياء <no-reply@noor-alawsiya.com>');
  // Resend refuses: the admin and the invite are rolled back.
  const before = await countAdmins();
  resendStatus = 403;
  await assert.rejects(inviteAdmin(db, { email: 'refused@example.test', role: 'staff', actorId: null }, deps), /Resend answered 403/);
  assert.equal(await countAdmins(), before);
  assert.equal((await db.query(`select 1 from admins where email = 'refused@example.test'`)).length, 0);
});

test('the operator command without RESEND_API_KEY fails clearly and creates nothing (not even the database)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noor-invite-'));
  const pglite = path.join(dir, 'db');
  const env = { ...process.env, PGLITE_DIR: pglite, APP_ORIGIN: ORIGIN, RESEND_API_KEY: '', DATABASE_URL: '' };
  const run = promisify(execFile)(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), '--conditions=react-server', 'scripts/create-admin.ts', '--invite', 'cli@example.test', '--role', 'super'], { env, cwd: process.cwd() });
  const err = await run.then(() => null, (e: { code: number; stderr: string; stdout: string }) => e);
  assert.ok(err, 'the command failed');
  assert.equal(err.code, 1);
  assert.match(err.stderr, /RESEND_API_KEY is not set\. Nothing was created\./);
  assert.ok(!`${err.stdout}${err.stderr}`.includes('cli@example.test'), 'the address is not printed');
  assert.equal(existsSync(pglite), false, 'the database was never opened');
});

test('links come from APP_ORIGIN only; nothing in the invite code reads the request Host', async () => {
  assert.equal(appOrigin({ APP_ORIGIN: 'https://noor-alawsiya.com' }), 'https://noor-alawsiya.com');
  assert.equal(appOrigin({ APP_ORIGIN: 'https://noor-alawsiya.com/' }), 'https://noor-alawsiya.com');
  for (const bad of ['http://noor-alawsiya.com', 'https://evil.test/path', 'https://user:pw@noor-alawsiya.com', 'javascript:alert(1)', 'noor-alawsiya.com']) {
    assert.throws(() => appOrigin({ APP_ORIGIN: bad }), MailConfigError, bad);
  }
  // A forged Host (as a proxy or attacker would send it) has no path into the link: the sending code never reads headers.
  for (const file of ['lib/invites.ts', 'lib/mail.ts', 'app/admin/admins/actions.ts', 'scripts/create-admin.ts']) {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.ok(!/next\/headers|headers\(\)|\bhost\b|x-forwarded/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), `${file} does not read request headers`);
  }
  await inviteAdmin(db, { email: 'origin@example.test', role: 'staff', actorId: superId }, deps);
  const links = outbox[0].body.text.match(/https?:\/\/[^\s]+/g)!;
  assert.deepEqual(links.map((l) => new URL(l).origin), [ORIGIN]);
  assert.ok(outbox[0].body.html.includes(`href="${ORIGIN}/admin/invite/`));
});

test('wrong codes on one invite are limited; so are bad tokens from one address', async () => {
  await inviteAdmin(db, { email: 'throttle@example.test', role: 'staff', actorId: superId }, deps);
  const token = lastToken();
  const s = await setInvitePassword(db, token, { name: 'مشرف المحاولات', password: 'throttle-admin-pw', confirm: 'throttle-admin-pw' }, IP);
  assert.ok(s.ok && !s.activated);
  for (let i = 0; i < 5; i++) assert.deepEqual(await confirmInviteTotp(db, token, '000000', `10.2.0.${i}`), { ok: false, reason: 'code' });
  assert.deepEqual(await confirmInviteTotp(db, token, totpAt(s.secret, Date.now()), '10.2.0.99'), { ok: false, reason: 'throttled' }, 'even the right code waits, from any address');
  await db.query('delete from invite_attempts');
  assert.ok((await confirmInviteTotp(db, token, totpAt(s.secret, Date.now()), IP)).ok, 'after the window it works');

  for (let i = 0; i < 20; i++) assert.deepEqual(await viewInvite(db, `${'x'.repeat(42)}${i % 10}`, '10.3.0.1'), { ok: false, reason: 'invalid' });
  assert.deepEqual(await viewInvite(db, 'y'.repeat(43), '10.3.0.1'), { ok: false, reason: 'throttled' });
  // parallel guesses cannot slip past the limit
  await db.query('delete from invite_attempts');
  const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => viewInvite(db, `${'z'.repeat(41)}${String(i).padStart(2, '0')}`, '10.4.0.1')));
  assert.equal(burst.filter((r) => !r.ok && r.reason === 'invalid').length, 20);
});

test('disable ends sessions and logins; unlock clears the 15-minute lock; nobody acts on themselves', async () => {
  const { adminId, totpSecret } = await createAdmin(db, { name: 'مشرف للإيقاف', email: 'stop@example.test', password: 'stop-admin-password', role: 'staff' });
  const { token } = await createSession(db, 'admin', adminId);
  await setAdminDisabled(db, superId, adminId, true);
  assert.equal(await readSession(db, token), null);
  assert.deepEqual(await loginAdmin(db, 'stop@example.test', 'stop-admin-password', totpAt(totpSecret, Date.now()), IP), { ok: false, reason: 'invalid' });
  await setAdminDisabled(db, superId, adminId, false);
  assert.ok((await loginAdmin(db, 'stop@example.test', 'stop-admin-password', totpAt(totpSecret, Date.now()), IP)).ok);

  // Same address throughout, so this holds both under PR #2 (5 per e-mail) and under the review branch (5 per e-mail and address).
  for (let i = 0; i < 5; i++) await loginAdmin(db, 'stop@example.test', 'wrong-password-x', '000000', '10.5.0.1');
  const locked = await loginAdmin(db, 'stop@example.test', 'stop-admin-password', totpAt(totpSecret, Date.now() + 30_000), '10.5.0.1');
  assert.deepEqual(locked, { ok: false, reason: 'throttled' }, 'PR #2 lock rule unchanged');
  assert.equal((await listAdmins(db)).find((a) => a.id === adminId)?.locked, true);
  await unlockAdmin(db, superId, adminId);
  assert.ok((await loginAdmin(db, 'stop@example.test', 'stop-admin-password', totpAt(totpSecret, Date.now() + 30_000), '10.5.0.1')).ok);

  await assert.rejects(setAdminDisabled(db, superId, superId, true), (e: InviteError) => e.code === 'self');
  await assert.rejects(resendInvite(db, superId, superId, deps, { reset: true }), (e: InviteError) => e.code === 'self');
  await assert.rejects(inviteAdmin(db, { email: 'super@example.test', role: 'staff', actorId: superId, reset: true }, deps), (e: InviteError) => e.code === 'self');
});

test('an active admin is only re-invited on purpose (lost phone), which clears their password and authenticator', async () => {
  const { adminId } = await createAdmin(db, { name: 'مشرف فقد هاتفه', email: 'lost@example.test', password: 'lost-admin-password', role: 'staff' });
  await assert.rejects(inviteAdmin(db, { email: 'lost@example.test', role: 'staff', actorId: null }, deps), (e: InviteError) => e.code === 'already-active');
  await assert.rejects(resendInvite(db, superId, adminId, deps), (e: InviteError) => e.code === 'not-pending');
  const { token } = await createSession(db, 'admin', adminId);
  await resendInvite(db, superId, adminId, deps, { reset: true });
  assert.equal(await readSession(db, token), null);
  const [r] = await db.query<{ password_hash: string | null; totp_secret: string | null }>('select password_hash, totp_secret from admins where id = $1', [adminId]);
  assert.deepEqual(r, { password_hash: null, totp_secret: null });
  assert.equal((await viewInvite(db, lastToken(), IP)).ok, true);
});

// Last: looks back over everything the tests above did.
test('no token and no address in the audit log, the attempt log, or anything printed', async () => {
  await inviteAdmin(db, { email: 'final@example.test', role: 'staff', actorId: superId }, deps);
  const audit = JSON.stringify(await db.query('select action, target, detail from audit_log'));
  const attempts = JSON.stringify(await db.query('select * from invite_attempts'));
  assert.match(audit, /admin\.invite\.accept/);
  assert.match(audit, /admin\.reinvite/);
  const emails = (await db.query<{ email: string }>('select email from admins')).map((r) => r.email);
  assert.ok(emails.length >= 10 && everyToken.length >= 10);
  for (const s of [...emails, ...everyToken, 'example.test']) {
    assert.ok(!audit.includes(s), 'audit log is clean');
    assert.ok(!attempts.includes(s), 'attempt log is clean');
    assert.ok(!printed.some((p) => p.includes(s)), 'nothing printed');
  }
});
