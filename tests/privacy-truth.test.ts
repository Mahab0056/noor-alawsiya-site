// /privacy must say what the site really does (awsiya-privacy-truth, 21/11/2026): the processors it uses, who sees a
// request, and that attempts are deleted after a day by a scheduled pass, not only when the next attempt arrives.
// In-memory PGlite (or TEST_DATABASE_URL), invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { resetDbForTests, type Db } from '@/lib/db';
import { maybePrune, PRUNE_EVERY_MS, pruneExpired, resetPruneClockForTests } from '@/lib/retention';

let db: Db;
let adminId: number;

before(async () => {
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'privacy-truth@example.test', password: 'a-long-test-password', role: 'staff' })).adminId;
});
after(async () => {
  await db.close();
});

const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${table}`))[0].n);

test('pruneExpired deletes attempts older than a day and expired sessions, and keeps the recent ones', async () => {
  const old = "now() - interval '25 hours'";
  const recent = "now() - interval '23 hours'";
  for (const at of [old, recent]) {
    await db.query(`insert into login_attempts (scope, identifier, ip, succeeded, created_at) values ('student', '07701112233', '10.0.0.1', false, ${at})`);
    await db.query(`insert into registration_attempts (ip, created_at) values ('10.0.0.1', ${at})`);
    await db.query(`insert into invite_attempts (ip, created_at) values ('10.0.0.1', ${at})`);
    await db.query(
      `insert into admin_login_codes (admin_id, challenge_hash, code_mac, created_at, expires_at) values ($1, md5(random()::text), 'mac', ${at}, ${at} + interval '10 minutes')`,
      [adminId]
    );
  }
  await db.query(`insert into sessions (token_hash, kind, admin_id, expires_at) values ('expired', 'admin', $1, now() - interval '1 minute'), ('live', 'admin', $1, now() + interval '1 hour')`, [adminId]);
  await db.query(
    `insert into admin_devices (admin_id, token_hash, created_at, expires_at) values ($1, 'gone', now() - interval '31 days', now() - interval '1 day'), ($1, 'kept', now(), now() + interval '30 days')`,
    [adminId]
  );

  await pruneExpired(db);

  for (const t of ['login_attempts', 'registration_attempts', 'invite_attempts', 'admin_login_codes']) assert.equal(await count(t), 1, `${t}: only the recent row is left`);
  assert.deepEqual((await db.query<{ token_hash: string }>('select token_hash from sessions')).map((r) => r.token_hash), ['live']);
  assert.deepEqual((await db.query<{ token_hash: string }>('select token_hash from admin_devices')).map((r) => r.token_hash), ['kept']);
});

test('maybePrune runs at most once an hour and never waits for the delete', async () => {
  resetPruneClockForTests();
  await db.query(`insert into registration_attempts (ip, created_at) values ('10.0.0.9', now() - interval '2 days')`);
  const t0 = 1_000_000_000_000;
  assert.equal(maybePrune(db, t0), true);
  assert.equal(maybePrune(db, t0 + PRUNE_EVERY_MS - 1), false, 'second call within the hour does nothing');
  assert.equal(maybePrune(db, t0 + PRUNE_EVERY_MS), true, 'an hour later it runs again');
  await new Promise((r) => setTimeout(r, 200)); // let the background pass finish
  assert.equal(Number((await db.query<{ n: string }>(`select count(*) as n from registration_attempts where ip = '10.0.0.9'`))[0].n), 0);
  resetPruneClockForTests();
});

test('getDb only prunes inside the running Next server', () => {
  const src = readFileSync('lib/db.ts', 'utf8');
  assert.match(src, /NEXT_RUNTIME === 'nodejs'/);
  assert.match(src, /phase-production-build/);
});

test('/privacy names the processors and who sees a request, and no longer claims «no one outside the school»', () => {
  const page = readFileSync('app/privacy/page.tsx', 'utf8');
  for (const s of ['Railway', 'Resend', 'واتساب', 'Meta', 'تُحذف تلقائياً بعد يوم واحد', 'ومحاولات التسجيل (عنوان الاتصال فقط)', 'يرى طلبات جميع الدورات']) assert.ok(page.includes(s), s);
  for (const s of ['لا نشاركها مع أي جهة خارج المدرسة', 'والأستاذ المسؤول عن دورتك فقط', 'يوماً واحداً ثم تُحذف']) assert.ok(!page.includes(s), `still says: ${s}`);
});
