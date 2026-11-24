// The daily admin digest (ADMIN_DIGEST, off by default): counts only, once per Baghdad day, super admins only, the
// bearer-token route, and nothing about any student in the e-mail. Invented data only; every mailer here is a stub.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { after, before, beforeEach, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { adminDigestOn, baghdadDay, digestLink, digestMail, digestRecipients, digestStats, digestTokenOk, runAdminDigest } from '@/lib/admin-digest';
import { reviewRequest } from '@/lib/admin';
import { requestCourse } from '@/lib/course-requests';
import { resetDbForTests, type Db } from '@/lib/db';
import type { Mail } from '@/lib/email';
import { HOUR } from '@/lib/queue';
import { register } from '@/lib/registration';
import * as route from '@/app/api/cron/admin-digest/route';

const NOW = new Date('2026-11-24T06:00:00Z'); // 09:00 in Baghdad, when the cron runs
const TOKEN = 'digest-test-token-0123456789abcdefghijkl'; // invented, 40 characters
const ON = { ADMIN_DIGEST: '1', APP_ORIGIN: 'https://noor-alawsiya.example' };
const YEAR = new Date().getFullYear();

// Invented students. None of these may appear anywhere in the e-mail.
const STUDENTS = [
  { fullName: 'زينب حيدر الموسوي', phone: '07701112233', guardianName: 'حيدر كاظم الموسوي', guardianPhone: '07809998877', age: 12, course: 'tajweed', hoursAgo: 72 },
  { fullName: 'مرتضى علي الحسيني', phone: '07712223344', guardianName: '', guardianPhone: '', age: 25, course: 'tajweed', hoursAgo: 30 },
  { fullName: 'فاطمة جواد العبيدي', phone: '07723334455', guardianName: 'جواد عباس العبيدي', guardianPhone: '07818887766', age: 15, course: 'nagham', hoursAgo: 50 },
  { fullName: 'سجاد كريم الربيعي', phone: '07734445566', guardianName: '', guardianPhone: '', age: 30, course: 'nagham', hoursAgo: 2 },
  { fullName: 'نرجس صادق التميمي', phone: '07745556677', guardianName: '', guardianPhone: '', age: 40, course: 'tajweed', hoursAgo: 100, decided: true },
];
const STUDENT_NOTE = 'ملاحظة سرية تجريبية عن موعد الطالب';
const ADMIN_EMAILS = { boss: 'boss@example.test', boss2: 'second-boss@example.test', staff: 'staff@example.test', off: 'off@example.test', invited: 'invited@example.test' };

let db: Db;
const courses: Record<string, number> = {};

type Sent = Mail[];
const stub = (sent: Sent, fail: (to: string) => boolean = () => false) => async (m: Mail) => {
  if (fail(m.to)) throw new Error('stub refused');
  sent.push(m);
};
const logRows = async () => db.query<{ day: string; waiting: number }>(`select to_char(day, 'YYYY-MM-DD') as day, waiting from admin_digest_log order by day`);

before(async () => {
  db = await resetDbForTests();
  // The owner row seeded by 0005 is real config, not test data: these tests use invented admins only.
  await db.query('delete from admins');
  await createAdmin(db, { name: 'مدير أعلى تجريبي', email: ADMIN_EMAILS.boss, role: 'super_admin' });
  await createAdmin(db, { name: 'مالك قديم تجريبي', email: ADMIN_EMAILS.boss2, role: 'owner' });
  await createAdmin(db, { name: 'مشرف تجريبي', email: ADMIN_EMAILS.staff, role: 'staff' });
  const off = (await createAdmin(db, { name: 'مدير موقوف', email: ADMIN_EMAILS.off, role: 'super_admin' })).adminId;
  await db.query('update admins set disabled_at = now() where id = $1', [off]);
  const invited = (await createAdmin(db, { name: 'مدير مدعو', email: ADMIN_EMAILS.invited, role: 'super_admin' })).adminId;
  await db.query('update admins set activated_at = null where id = $1', [invited]);

  const course = async (key: string, name: string) =>
    (courses[key] = Number((await db.query<{ id: string }>(`insert into courses (name, teacher, published, status) values ($1, 'أستاذ تجريبي', true, 'open') returning id`, [name]))[0].id));
  await course('tajweed', 'دورة التجويد <المستوى الأول>');
  await course('nagham', 'دورة النغم القرآني');
  await course('quiet', 'دورة بلا طلبات');
});
after(async () => {
  await db.close();
});

async function seedRequests() {
  await db.query('delete from registrations');
  await db.query('delete from students');
  for (const s of STUDENTS) {
    const r = await register(db, {
      fullName: s.fullName, birthYear: String(YEAR - s.age), phone: s.phone, password: 'password-1',
      guardianName: s.guardianName, guardianPhone: s.guardianPhone, guardianConsent: s.age < 18, courseId: String(courses[s.course]), answers: {},
    });
    assert.ok(r.ok, JSON.stringify(r));
    await db.query(`update registrations set created_at = $2 where student_id = $1`, [r.studentId, new Date(NOW.getTime() - s.hoursAgo * HOUR)]);
    if (s.decided) {
      const [{ id }] = await db.query<{ id: string }>('select id from registrations where student_id = $1', [r.studentId]);
      const [{ id: adminId }] = await db.query<{ id: string }>('select id from admins where email = $1', [ADMIN_EMAILS.staff]);
      assert.equal(await reviewRequest(db, Number(adminId), Number(id), 'accepted', 'ملاحظة المشرف التجريبية'), 'saved');
    }
  }
  // A second course asked for from «حسابي», with the student's own note.
  const [{ id: studentId }] = await db.query<{ id: string }>('select id from students where phone = $1', [STUDENTS[3].phone]);
  const second = await requestCourse(db, Number(studentId), { courseId: String(courses.tajweed), note: STUDENT_NOTE, guardianConsent: false }, NOW);
  assert.ok(second.ok, JSON.stringify(second));
  await db.query(`update registrations set created_at = $2 where student_id = $1 and course_id = $3`, [studentId, new Date(NOW.getTime() - 5 * HOUR), courses.tajweed]);
}

beforeEach(async () => {
  await db.query('delete from admin_digest_log');
  await seedRequests();
});

// ---------------------------------------------------------------- flag, token, day

test('the flag is off unless ADMIN_DIGEST is 1 / true / on', () => {
  assert.equal(adminDigestOn({}), false);
  for (const v of ['', '0', 'false', 'off', 'yes', ' ']) assert.equal(adminDigestOn({ ADMIN_DIGEST: v }), false, v);
  for (const v of ['1', 'true', 'ON', ' on ']) assert.equal(adminDigestOn({ ADMIN_DIGEST: v }), true, v);
});

test('the token: only the exact bearer value matches; unset or short tokens never match', () => {
  const env = { ADMIN_DIGEST_TOKEN: TOKEN };
  assert.equal(digestTokenOk(`Bearer ${TOKEN}`, env), true);
  assert.equal(digestTokenOk(`Bearer ${TOKEN}x`, env), false);
  assert.equal(digestTokenOk(`Bearer ${TOKEN.slice(0, -1)}`, env), false);
  assert.equal(digestTokenOk(`bearer ${TOKEN}`, env), false);
  assert.equal(digestTokenOk(TOKEN, env), false);
  assert.equal(digestTokenOk('Bearer ', env), false);
  assert.equal(digestTokenOk(null, env), false);
  assert.equal(digestTokenOk(undefined, env), false);
  assert.equal(digestTokenOk('Bearer ', {}), false, 'unset token and empty bearer must not match');
  assert.equal(digestTokenOk('Bearer short', { ADMIN_DIGEST_TOKEN: 'short' }), false, 'a token under 32 characters is refused');
});

test('the Baghdad day turns at 21:00 UTC (midnight in Baghdad)', () => {
  assert.equal(baghdadDay(new Date('2026-11-24T20:59:59.999Z')), '2026-11-24');
  assert.equal(baghdadDay(new Date('2026-11-24T21:00:00Z')), '2026-11-25');
  assert.equal(baghdadDay(new Date('2026-11-23T21:00:00Z')), '2026-11-24');
  assert.equal(baghdadDay(new Date('2026-12-31T21:30:00Z')), '2027-01-01');
});

// ---------------------------------------------------------------- once a day

test('flag off: nothing is read, written or sent', async () => {
  const sent: Sent = [];
  assert.deepEqual(await runAdminDigest(db, NOW, { send: stub(sent), env: { APP_ORIGIN: ON.APP_ORIGIN } }), { status: 'off' });
  assert.deepEqual(await runAdminDigest(db, NOW, { send: stub(sent), env: { ...ON, ADMIN_DIGEST: '0' } }), { status: 'off' });
  assert.equal(sent.length, 0);
  assert.deepEqual(await logRows(), []);
});

test('two calls on the same Baghdad day send one digest per super admin, once', async () => {
  const sent: Sent = [];
  const first = await runAdminDigest(db, NOW, { send: stub(sent), env: ON });
  assert.deepEqual(first, { status: 'sent', day: '2026-11-24', waiting: 5, sent: 2, failed: 0 });
  assert.deepEqual(sent.map((m) => m.to).sort(), [ADMIN_EMAILS.boss, ADMIN_EMAILS.boss2].sort());
  // Later the same day (23:59 Baghdad): nothing more.
  assert.deepEqual(await runAdminDigest(db, new Date('2026-11-24T20:59:00Z'), { send: stub(sent), env: ON }), { status: 'already', day: '2026-11-24' });
  assert.equal(sent.length, 2);
  assert.deepEqual(await logRows(), [{ day: '2026-11-24', waiting: 5 }]);
  // Midnight in Baghdad is a new day.
  const next = await runAdminDigest(db, new Date('2026-11-24T21:00:00Z'), { send: stub(sent), env: ON });
  assert.equal(next.status, 'sent');
  assert.equal(sent.length, 4);
  assert.deepEqual((await logRows()).map((r) => r.day), ['2026-11-24', '2026-11-25']);
});

test('two calls at the same moment still send once (the day is claimed before sending)', async () => {
  const sent: Sent = [];
  const results = await Promise.all([1, 2, 3].map(() => runAdminDigest(db, NOW, { send: stub(sent), env: ON })));
  assert.equal(results.filter((r) => r.status === 'sent').length, 1, JSON.stringify(results));
  assert.equal(sent.length, 2);
  assert.equal((await logRows()).length, 1);
});

test('nothing waiting: no e-mail and no row, so a request later that day still gets a digest', async () => {
  await db.query(`update registrations set status = 'rejected', reviewed_at = now() where status = 'pending'`);
  const sent: Sent = [];
  assert.deepEqual(await runAdminDigest(db, NOW, { send: stub(sent), env: ON }), { status: 'nothing', day: '2026-11-24' });
  assert.equal(sent.length, 0);
  assert.deepEqual(await logRows(), []);
});

test('no active super admin: nothing sent, no row', async () => {
  await db.query(`update admins set disabled_at = now() where role in ('owner', 'super_admin') and disabled_at is null`);
  try {
    const sent: Sent = [];
    assert.deepEqual(await runAdminDigest(db, NOW, { send: stub(sent), env: ON }), { status: 'no-recipients', day: '2026-11-24', waiting: 5 });
    assert.equal(sent.length, 0);
    assert.deepEqual(await logRows(), []);
  } finally {
    await db.query(`update admins set disabled_at = null where email in ($1, $2)`, [ADMIN_EMAILS.boss, ADMIN_EMAILS.boss2]);
  }
});

test('if no e-mail goes out the day is not recorded and the next call tries again; one failure out of two is kept', async () => {
  const sent: Sent = [];
  await assert.rejects(runAdminDigest(db, NOW, { send: stub(sent, () => true), env: ON }), /could not be sent to anyone/);
  assert.deepEqual(await logRows(), []);
  const partial = await runAdminDigest(db, NOW, { send: stub(sent, (to) => to === ADMIN_EMAILS.boss2), env: ON });
  assert.deepEqual(partial, { status: 'sent', day: '2026-11-24', waiting: 5, sent: 1, failed: 1 });
  assert.equal((await logRows()).length, 1);
});

test('without APP_ORIGIN, or with the real sender and no mail settings, it refuses before writing anything', async () => {
  const sent: Sent = [];
  await assert.rejects(runAdminDigest(db, NOW, { send: stub(sent), env: { ADMIN_DIGEST: '1' } }), /APP_ORIGIN/);
  assert.equal(sent.length, 0);
  // Default sender (lib/email.ts): the missing variable is named, and nothing is sent or recorded.
  await assert.rejects(runAdminDigest(db, NOW, { env: ON }), /RESEND_API_KEY is not set/);
  await assert.rejects(runAdminDigest(db, NOW, { env: { ...ON, RESEND_API_KEY: 're_stub_not_a_real_key_000' } }), /EMAIL_FROM is not set/);
  assert.deepEqual(await logRows(), []);
});

// ---------------------------------------------------------------- who and what

test('recipients: active owner / super admin only; staff, disabled and invited admins get nothing', async () => {
  assert.deepEqual((await digestRecipients(db)).sort(), [ADMIN_EMAILS.boss, ADMIN_EMAILS.boss2].sort());
});

test('the numbers match the /admin queue: waiting, oldest, over 48 h, per course', async () => {
  const stats = await digestStats(db, NOW);
  assert.equal(stats.waiting, 5);
  assert.equal(stats.oldest?.toISOString(), new Date(NOW.getTime() - 72 * HOUR).toISOString());
  assert.equal(stats.overdue, 2); // 72 h and 50 h; the 100 h one was accepted
  assert.deepEqual(stats.courses, [{ name: 'دورة التجويد <المستوى الأول>', waiting: 3 }, { name: 'دورة النغم القرآني', waiting: 2 }]);
  // Exactly 48:00 counts as over, as the red badge does.
  await db.query(`update registrations set created_at = $1 where created_at = $2`, [new Date(NOW.getTime() - 48 * HOUR), new Date(NOW.getTime() - 30 * HOUR)]);
  assert.equal((await digestStats(db, NOW)).overdue, 3);
});

test('the e-mail: Arabic RTL, counts, per course, one escaped link to the waiting list oldest first', async () => {
  const mail = digestMail(await digestStats(db, NOW), NOW, ON.APP_ORIGIN);
  assert.equal(mail.subject, 'نور الأوصياء: ٥ طلبات تنتظر، أقدمها منذ ٣ أيام');
  assert.match(mail.html, /<html lang="ar" dir="rtl">/);
  assert.match(mail.html, /<body dir="rtl"/);
  for (const part of [mail.html, mail.text]) {
    assert.ok(part.includes('٥ طلبات تنتظر، أقدمها منذ ٣ أيام'));
    assert.ok(part.includes('تجاوزت ٤٨ ساعة'));
    assert.ok(part.includes('دورة النغم القرآني'));
    assert.ok(!part.includes('دورة بلا طلبات'), 'courses with nothing waiting are left out');
  }
  assert.ok(mail.text.includes('- دورة التجويد <المستوى الأول>: ٣'));
  assert.ok(mail.html.includes('دورة التجويد &lt;المستوى الأول&gt;'), 'course names are escaped in HTML');
  assert.ok(!mail.html.includes('<المستوى'));
  const link = digestLink(ON.APP_ORIGIN);
  assert.equal(link, 'https://noor-alawsiya.example/admin?status=pending&sort=oldest');
  assert.ok(mail.text.includes(link));
  assert.equal(mail.html.match(/<a /g)?.length, 1, 'one link only');
  assert.ok(mail.html.includes(`href="${link.replace('&', '&amp;')}"`));
});

test('the e-mail holds no student or guardian name, phone, age, birth year or note, and no admin address', async () => {
  const sent: Sent = [];
  await runAdminDigest(db, NOW, { send: stub(sent), env: ON });
  assert.equal(sent.length, 2);
  const ar = (s: string) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  const forbidden = new Set<string>([STUDENT_NOTE, 'ملاحظة المشرف التجريبية', ...Object.values(ADMIN_EMAILS)]);
  for (const s of STUDENTS) {
    for (const v of [s.fullName, s.phone, s.guardianName, s.guardianPhone, String(YEAR - s.age)]) {
      if (!v) continue;
      forbidden.add(v);
      forbidden.add(ar(v));
      for (const word of v.split(' ')) if (word.length > 3 && !/^\d+$/.test(word)) forbidden.add(word); // first names, family names
    }
    forbidden.add(s.phone.slice(-7)); // a phone without its prefix
    forbidden.add(ar(s.phone.slice(-7)));
    forbidden.add(`${s.age} سنة`);
    forbidden.add(`${ar(String(s.age))} سنة`);
  }
  for (const m of sent) {
    const all = [m.subject, m.text, m.html].join('\n');
    for (const f of forbidden) assert.ok(!all.includes(f), `the e-mail must not contain «${f}»`);
    assert.ok(!/07\d{9}|٠٧[٠-٩]{9}|\+?964/.test(all), 'no phone-shaped number');
  }
});

// ---------------------------------------------------------------- route and script

const call = (headers: Record<string, string> = {}, method = 'POST') =>
  (route as unknown as Record<string, (r: Request) => Promise<Response> | Response>)[method](new Request('http://localhost/api/cron/admin-digest', { method, headers }));

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    old[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(old)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

// The route uses the real lib/email.ts sender. fetch is replaced, so nothing can leave this machine.
async function withFetchStub<T>(fn: (calls: { url: string; body: { to: string[]; subject: string } }[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: { url: string; body: { to: string[]; subject: string } }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response('{"id":"stub"}', { status: 200 });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const ROUTE_ENV = { ...ON, ADMIN_DIGEST_TOKEN: TOKEN, RESEND_API_KEY: 're_stub_not_a_real_key_000', EMAIL_FROM: 'نور الأوصياء <noreply@mail.noor-alawsiya.example>' };

test('route: flag off is a 404 even with the right token, and nothing is written or sent', async () => {
  await withFetchStub(async (calls) => {
    await withEnv({ ...ROUTE_ENV, ADMIN_DIGEST: undefined }, async () => {
      const res = await call({ authorization: `Bearer ${TOKEN}` });
      assert.equal(res.status, 404);
      assert.equal(await res.text(), 'Not Found');
    });
    assert.equal(calls.length, 0);
  });
  assert.deepEqual(await logRows(), []);
});

test('route: a missing or wrong token is the same 404 as flag off; other methods too', async () => {
  await withFetchStub(async (calls) => {
    await withEnv(ROUTE_ENV, async () => {
      for (const headers of <Record<string, string>[]>[{}, { authorization: 'Bearer wrong-token-wrong-token-wrong-token-00' }, { authorization: `Bearer ${TOKEN} ` + 'x' }, { authorization: TOKEN }]) {
        const res = await call(headers);
        assert.equal(res.status, 404, JSON.stringify(headers));
        assert.equal(await res.text(), 'Not Found');
      }
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal((await call({ authorization: `Bearer ${TOKEN}` }, method)).status, 404, method);
    });
    await withEnv({ ...ROUTE_ENV, ADMIN_DIGEST_TOKEN: undefined }, async () => {
      assert.equal((await call({ authorization: 'Bearer ' })).status, 404, 'no token configured');
    });
    assert.equal(calls.length, 0);
  });
  assert.deepEqual(await logRows(), []);
});

test('route: the right token sends through the (stubbed) mailer once, and answers with counts only', async () => {
  await withFetchStub(async (calls) => {
    await withEnv(ROUTE_ENV, async () => {
      const first = await call({ authorization: `Bearer ${TOKEN}` });
      assert.equal(first.status, 200);
      const body = await first.json();
      assert.equal(body.status, 'sent');
      assert.equal(body.sent, 2);
      assert.ok(!JSON.stringify(body).includes('@'), 'no address in the answer');
      const second = await call({ authorization: `Bearer ${TOKEN}` });
      assert.equal((await second.json()).status, 'already');
    });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.url === 'https://api.resend.com/emails' && c.body.to.length === 1));
  });
});

test('npm run digest with the flag off prints «off», exits 0 and does not open a database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-off-'));
  const pglite = join(dir, 'never-created');
  try {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, PGLITE_DIR: pglite, NODE_ENV: 'test' };
    const { stdout } = await promisify(execFile)(process.execPath, [join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), '--conditions=react-server', 'scripts/admin-digest.ts'], { env, cwd: process.cwd() });
    assert.equal(stdout.trim(), 'admin-digest: off');
    assert.equal(existsSync(pglite), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
