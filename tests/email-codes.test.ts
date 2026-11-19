// Admin sign-in with a code sent by e-mail (the default since 19/11/2026; ADMIN_TOTP is off), on an in-memory PGlite
// database with a local stand-in for Resend. Invented data only: no real address, no real key, no e-mail leaves this process.
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createAdmin, getAdmin, loginAdmin } from '@/lib/accounts';
import { pickClientIp } from '@/lib/client-ip';
import { resetDbForTests, type Db } from '@/lib/db';
import { CODE_TRIES, CODES_PER_HOUR, rememberDevice, verifyLoginCode } from '@/lib/email-codes';
import { inviteAdmin, setAdminDisabled, setInvitePassword, viewInvite } from '@/lib/invites';
import { DEFAULT_MAIL_FROM, LOGIN_CODE_SUBJECT, mailConfig, type Fetch, type MailConfig } from '@/lib/mail';

delete process.env.ADMIN_TOTP; // the default path

let db: Db;
let superId: number;
let staffId: number;
const IP = '10.2.0.1';
const PASSWORD = 'a-long-test-password';
const mail: MailConfig = mailConfig({ RESEND_API_KEY: 're_test_not_a_real_key_000000', APP_ORIGIN: 'https://noor-alawsiya.test' });

type Sent = { from: string; to: string[]; subject: string; text: string; html: string };
let outbox: Sent[] = [];
let resendStatus = 200;
const stub: Fetch = async (_url, init) => {
  outbox.push(JSON.parse(String(init.body)));
  return new Response('{"id":"stub"}', { status: resendStatus });
};
const codeDeps = () => ({ mail, fetchImpl: stub });
const lastCode = () => outbox.at(-1)!.text.match(/^(\d{6})$/m)![1];

const printed: string[] = [];
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };

before(async () => {
  db = await resetDbForTests();
  superId = (await createAdmin(db, { name: 'مدير أعلى تجريبي', email: 'super@example.test', password: PASSWORD, role: 'super_admin' })).adminId;
  staffId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'staff@example.test', password: PASSWORD, role: 'staff' })).adminId;
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
  await db.query('delete from login_attempts');
  await db.query('delete from invite_attempts');
  await db.query('delete from admin_login_codes');
  await db.query('delete from admin_devices');
});

async function signIn(email: string, opts: { deviceToken?: string; ip?: string; password?: string } = {}) {
  return loginAdmin(db, email, opts.password ?? PASSWORD, '', opts.ip ?? IP, { deviceToken: opts.deviceToken, codeDeps });
}

test('right password on a new device: a 6-digit code is e-mailed; the right code signs in once', async () => {
  const r = await signIn('Staff@Example.test');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'code-sent');
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0].to, ['staff@example.test']);
  assert.equal(outbox[0].from, DEFAULT_MAIL_FROM);
  assert.equal(outbox[0].subject, LOGIN_CODE_SUBJECT);
  assert.match(outbox[0].html, /<html lang="ar" dir="rtl">/);
  assert.ok(!/otpauth|QR|تطبيق المصادقة/.test(outbox[0].text + outbox[0].html), 'no authenticator, no QR');
  const challenge = !r.ok && r.reason === 'code-sent' ? r.challenge : '';
  const code = lastCode();

  const wrong = code === '000000' ? '111111' : '000000';
  assert.deepEqual(await verifyLoginCode(db, challenge, wrong), { ok: false, reason: 'code', triesLeft: CODE_TRIES - 1 });
  assert.deepEqual(await verifyLoginCode(db, challenge, code), { ok: true, adminId: staffId });
  assert.deepEqual(await verifyLoginCode(db, challenge, code), { ok: false, reason: 'expired' }, 'one use');
});

test('Arabic-Indic digits and spaces are accepted', async () => {
  const r = await signIn('staff@example.test');
  const challenge = !r.ok && r.reason === 'code-sent' ? r.challenge : '';
  const arabic = lastCode().replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  assert.deepEqual(await verifyLoginCode(db, challenge, ` ${arabic.slice(0, 3)} ${arabic.slice(3)} `), { ok: true, adminId: staffId });
});

test('wrong password, unknown e-mail, pending or disabled admin: the same "invalid", and no e-mail', async () => {
  assert.deepEqual(await signIn('staff@example.test', { password: 'wrong-password-123' }), { ok: false, reason: 'invalid' });
  assert.deepEqual(await signIn('nobody@example.test'), { ok: false, reason: 'invalid' });
  await inviteAdmin(db, { email: 'pending@example.test', role: 'staff', actorId: superId }, { mail, fetchImpl: stub });
  outbox = [];
  assert.deepEqual(await signIn('pending@example.test'), { ok: false, reason: 'invalid' });
  assert.equal(outbox.length, 0);
});

test('a code is useless without the challenge from the same browser, and after its tries are used up', async () => {
  const r = await signIn('staff@example.test');
  const challenge = !r.ok && r.reason === 'code-sent' ? r.challenge : '';
  const code = lastCode();
  assert.deepEqual(await verifyLoginCode(db, undefined, code), { ok: false, reason: 'expired' });
  assert.deepEqual(await verifyLoginCode(db, 'A'.repeat(43), code), { ok: false, reason: 'expired' });
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 1; i < CODE_TRIES; i++) assert.equal((await verifyLoginCode(db, challenge, wrong)).ok, false);
  assert.deepEqual(await verifyLoginCode(db, challenge, wrong), { ok: false, reason: 'expired' }, 'the fifth wrong try ends it');
  assert.deepEqual(await verifyLoginCode(db, challenge, code), { ok: false, reason: 'expired' }, 'the right code no longer works');
});

test('parallel guesses cannot get more than 5 tries', async () => {
  const r = await signIn('staff@example.test');
  const challenge = !r.ok && r.reason === 'code-sent' ? r.challenge : '';
  const code = lastCode();
  const guesses = Array.from({ length: 40 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
  const results = await Promise.all(guesses.map((g) => verifyLoginCode(db, challenge, g)));
  assert.ok(results.every((x) => !x.ok));
  assert.ok(results.filter((x) => !x.ok && x.reason === 'code').length < CODE_TRIES, 'the fifth wrong try reports expired, the rest are refused');
  const [{ attempts }] = await db.query<{ attempts: number }>('select attempts from admin_login_codes');
  assert.equal(Number(attempts), CODE_TRIES);
  assert.deepEqual(await verifyLoginCode(db, challenge, code), { ok: false, reason: 'expired' });
});

test('a code expires after 10 minutes; a newer code ends the older one', async () => {
  const r1 = await signIn('staff@example.test');
  const c1 = !r1.ok && r1.reason === 'code-sent' ? r1.challenge : '';
  const code1 = lastCode();
  const r2 = await signIn('staff@example.test');
  const c2 = !r2.ok && r2.reason === 'code-sent' ? r2.challenge : '';
  const code2 = lastCode();
  assert.deepEqual(await verifyLoginCode(db, c1, code1), { ok: false, reason: 'expired' }, 'older code ended');
  const [{ minutes }] = await db.query<{ minutes: number }>(`select extract(epoch from (expires_at - created_at)) / 60 as minutes from admin_login_codes where used_at is null`);
  assert.equal(Number(minutes), 10);
  await db.query(`update admin_login_codes set created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute'`);
  assert.deepEqual(await verifyLoginCode(db, c2, code2), { ok: false, reason: 'expired' });
});

test(`at most ${CODES_PER_HOUR} codes per admin per hour, even in parallel`, async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => signIn('staff@example.test', { ip: `10.3.0.${i + 1}` })));
  assert.equal(results.filter((r) => !r.ok && r.reason === 'code-sent').length, CODES_PER_HOUR);
  assert.equal(results.filter((r) => !r.ok && r.reason === 'throttled').length, 12 - CODES_PER_HOUR);
  assert.equal(outbox.length, CODES_PER_HOUR);
});

test('only hashes are stored; the code and challenge are never printed or audited', async () => {
  const r = await signIn('staff@example.test');
  const challenge = !r.ok && r.reason === 'code-sent' ? r.challenge : '';
  const code = lastCode();
  await verifyLoginCode(db, challenge, code);
  const rows = JSON.stringify(await db.query('select * from admin_login_codes'));
  assert.ok(!rows.includes(challenge) && !rows.includes(`"${code}"`), 'neither stored');
  const audit = JSON.stringify(await db.query('select * from audit_log'));
  const all = printed.join('\n') + audit + JSON.stringify(await db.query('select * from login_attempts'));
  assert.ok(!all.includes(challenge) && !all.includes(code), 'neither printed nor logged');
});

test('Resend refusing: "mail-failed", and no code is kept', async () => {
  resendStatus = 422;
  assert.deepEqual(await signIn('staff@example.test'), { ok: false, reason: 'mail-failed' });
  assert.equal((await db.query('select 1 from admin_login_codes')).length, 0);
});

test('remember this device: 30 days, this admin only; disabling the admin forgets it', async () => {
  const device = await rememberDevice(db, staffId);
  const days = (device.expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30);
  assert.deepEqual(await signIn('staff@example.test', { deviceToken: device.token }), { ok: true, adminId: staffId });
  assert.equal(outbox.length, 0, 'no code on a remembered device');
  // Still needs the right password.
  assert.deepEqual(await signIn('staff@example.test', { deviceToken: device.token, password: 'wrong-password-123' }), { ok: false, reason: 'invalid' });
  // Another admin's device token is worth nothing here.
  const r = await signIn('super@example.test', { deviceToken: device.token });
  assert.ok(!r.ok && r.reason === 'code-sent');
  // Expired.
  await db.query(`update admin_devices set created_at = now() - interval '31 days', expires_at = now() - interval '1 day'`);
  assert.ok(((r2) => !r2.ok && r2.reason === 'code-sent')(await signIn('staff@example.test', { deviceToken: device.token })));
  // Disabled, then enabled again: the device is forgotten.
  const d2 = await rememberDevice(db, staffId);
  await setAdminDisabled(db, superId, staffId, true);
  assert.equal(await getAdmin(db, staffId), null);
  await setAdminDisabled(db, superId, staffId, false);
  assert.ok(((r3) => !r3.ok && r3.reason === 'code-sent')(await signIn('staff@example.test', { deviceToken: d2.token })));
});

test('an admin disabled between the code and its use cannot sign in with it', async () => {
  const r = await signIn('staff@example.test');
  const challenge = !r.ok && r.reason === 'code-sent' ? r.challenge : '';
  const code = lastCode();
  await db.query('update admins set disabled_at = now() where id = $1', [staffId]);
  try {
    assert.deepEqual(await verifyLoginCode(db, challenge, code), { ok: false, reason: 'expired' });
  } finally {
    await db.query('update admins set disabled_at = null where id = $1', [staffId]);
  }
});

test('invite without the authenticator: name + password, then active and signed in; the link works once', async () => {
  await inviteAdmin(db, { email: 'new.admin@example.test', role: 'super_admin', actorId: superId }, { mail, fetchImpl: stub });
  const invite = outbox.at(-1)!;
  assert.ok(!/تطبيق المصادقة/.test(invite.text + invite.html), 'the invite does not mention an authenticator');
  const token = invite.text.match(/\/admin\/invite\/([A-Za-z0-9_-]+)/)![1];
  assert.equal((await viewInvite(db, token, IP)).ok, true);
  const done = await setInvitePassword(db, token, { name: 'مدير جديد', password: 'another-long-password', confirm: 'another-long-password' }, IP);
  assert.ok(done.ok && done.activated);
  const adminId = done.ok && done.activated ? done.adminId : 0;
  assert.equal((await getAdmin(db, adminId))?.role, 'super_admin');
  const [row] = await db.query<{ totp_secret: string | null; totp_pending_secret: string | null }>('select totp_secret, totp_pending_secret from admins where id = $1', [adminId]);
  assert.deepEqual(row, { totp_secret: null, totp_pending_secret: null }, 'no authenticator secret at all');
  assert.deepEqual(await setInvitePassword(db, token, { name: 'مدير جديد', password: 'another-long-password', confirm: 'another-long-password' }, IP), { ok: false, reason: 'invalid' });
  // Next sign-in on a new device: password, then a code by e-mail.
  outbox = [];
  const r = await loginAdmin(db, 'new.admin@example.test', 'another-long-password', '', IP, { codeDeps });
  assert.ok(!r.ok && r.reason === 'code-sent');
  assert.deepEqual(outbox[0].to, ['new.admin@example.test']);
});

test('two invite submits racing: only one activates', async () => {
  await inviteAdmin(db, { email: 'race@example.test', role: 'staff', actorId: superId }, { mail, fetchImpl: stub });
  const token = outbox.at(-1)!.text.match(/\/admin\/invite\/([A-Za-z0-9_-]+)/)![1];
  const input = { name: 'مشرف السباق', password: 'race-long-password', confirm: 'race-long-password' };
  const results = await Promise.all([1, 2, 3].map(() => setInvitePassword(db, token, input, IP)));
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test('admins: failures per e-mail are also capped across all addresses (forged or rotated client addresses)', async () => {
  let throttled = 0;
  for (let i = 0; i < 110; i++) {
    const r = await signIn('super@example.test', { ip: `10.9.${Math.floor(i / 250)}.${(i % 250) + 1}`, password: 'wrong-password-123' });
    if (!r.ok && r.reason === 'throttled') throttled++;
  }
  assert.equal(throttled, 10, '100 failures, then refused');
});

test('client address: X-Real-IP only when it is an IP; else the last X-Forwarded-For hop; else "unknown"', () => {
  assert.equal(pickClientIp('203.0.113.7', '1.1.1.1, 198.51.100.2'), '203.0.113.7');
  assert.equal(pickClientIp(' 2001:db8::1 ', null), '2001:db8::1');
  assert.equal(pickClientIp('x'.repeat(40), '1.1.1.1, 198.51.100.2'), '198.51.100.2');
  assert.equal(pickClientIp(null, '198.51.100.2, not-an-ip'), 'unknown');
  assert.equal(pickClientIp(null, null), 'unknown');
});
