// «بلّغوني لما تنفتح دورة»: the waitlist. Invented data only.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { setCourseAccepting } from '@/lib/courses';
import { migrate, resetDbForTests, type Db } from '@/lib/db';
import {
  allowWaitlist, joinWaitlist, listWaitlist, listWaitlistCourses, markNotified, MAX_WAITLIST_NEW_PER_DAY, MAX_WAITLIST_PER_IP_DAY, MAX_WAITLIST_PER_IP_HOUR,
  purgeWaitlist, removeEntry, waitingCounts, waitlistMessage, waLink, WAITLIST_KEEP_DAYS,
} from '@/lib/waitlist';
import { ANY_COURSE, validateWaitlist, WAITLIST_CONSENT_VERSION, WAITLIST_ERRORS, type WaitlistInput } from '@/lib/waitlist-rules';

let db: Db;
let adminId: number;
let closed: number;
let other: number;
let finished: number;
let accepting: number;

before(async () => {
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'waitlist@example.test', password: 'a-long-test-password', role: 'super_admin' })).adminId;
  const add = async (name: string, status: string, published: boolean) =>
    Number((await db.query<{ id: string }>(`insert into courses (name, teacher, status, published) values ($1, 'أستاذ تجريبي', $2::course_status, $3) returning id`, [name, status, published]))[0].id);
  closed = await add('دورة مسدودة', 'open', false);
  other = await add('دورة ثانية', 'unknown', false);
  finished = await add('دورة منتهية', 'done', false);
  accepting = await add('دورة مفتوحة', 'open', true);
});
after(async () => {
  await db.close();
});

const input = (over: Partial<WaitlistInput> = {}): WaitlistInput => ({ phone: '07701112233', guardianName: '', courseId: ANY_COURSE, ageBand: '', consent: true, ...over });
const ids = () => [closed, other];
const clean = (over: Partial<WaitlistInput> = {}) => {
  const r = validateWaitlist(input(over), ids());
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};
const liveRows = () => db.query<{ id: string; phone: string; course_id: string | null; guardian_name: string | null; notified_at: Date | null }>(`select id, phone, course_id, guardian_name, notified_at from course_waitlist where removed_at is null order by id`);

// ---------------------------------------------------------------- validation

test('phones are normalised like the registration form: +964, 00964, spaces, Arabic-Indic digits', () => {
  for (const raw of ['07701112233', '0770 111 2233', '+964 770 111 2233', '00964-770-111-2233', '٠٧٧٠١١١٢٢٣٣', '+٩٦٤٧٧٠١١١٢٢٣٣']) {
    assert.equal(clean({ phone: raw }).phone, '07701112233', raw);
  }
  for (const raw of ['', '0770111223', '077011122334', '01712345678', '07201112233', 'abc', '+1 202 555 0100']) {
    const r = validateWaitlist(input({ phone: raw }), ids());
    assert.equal(r.ok, false, raw);
    if (!r.ok) assert.equal(r.errors.phone, WAITLIST_ERRORS.phone);
  }
});

test('only the phone and the consent are required; name, course and age band are optional and checked', () => {
  assert.deepEqual(clean(), { phone: '07701112233', guardianName: null, courseId: null, ageBand: null });
  assert.deepEqual(clean({ guardianName: '  أبو   علي ', courseId: String(closed), ageBand: '10to14' }), { phone: '07701112233', guardianName: 'أبو علي', courseId: closed, ageBand: '10to14' });
  const bad = validateWaitlist(input({ guardianName: 'ا'.repeat(81), courseId: String(finished), ageBand: '1990' }), ids());
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['ageBand', 'courseId', 'guardianName']);
  for (const courseId of ['abc', '-1', String(accepting), '1e3']) assert.equal(validateWaitlist(input({ courseId }), ids()).ok, false, courseId);
});

test('consent is required', () => {
  const r = validateWaitlist(input({ consent: false }), ids());
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.errors, { consent: WAITLIST_ERRORS.consent });
});

test('a visitor can wait for a closed course that has not finished, never for a finished or an open one', async () => {
  assert.deepEqual((await listWaitlistCourses(db)).map((c) => c.id), [closed, other]);
});

// ---------------------------------------------------------------- storing

test('a repeat stores nothing new and looks the same; another course or «أي دورة» is its own entry', async () => {
  assert.equal(await joinWaitlist(db, clean({ courseId: String(closed), guardianName: 'أبو علي', ageBand: 'under10' })), 'saved');
  assert.equal(await joinWaitlist(db, clean({ phone: '+964 770 111 2233', courseId: String(closed), guardianName: 'اسم آخر' })), 'saved');
  assert.equal(await joinWaitlist(db, clean({ courseId: String(other) })), 'saved');
  assert.equal(await joinWaitlist(db, clean()), 'saved');
  assert.equal(await joinWaitlist(db, clean()), 'saved');
  const rows = await liveRows();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => (r.course_id === null ? null : Number(r.course_id))), [closed, other, null]);
  assert.equal(rows[0].guardian_name, 'أبو علي', 'a repeat does not overwrite the first details');
  const [c] = await db.query<{ consent_version: string; consented_at: Date }>('select consent_version, consented_at from course_waitlist where id = $1', [rows[0].id]);
  assert.equal(c.consent_version, WAITLIST_CONSENT_VERSION);
  assert.ok(c.consented_at instanceof Date);
});

test('the same phone and course at the same moment is stored once', async () => {
  const w = clean({ phone: '07801112233', courseId: String(closed) });
  const results = await Promise.all(Array.from({ length: 8 }, () => joinWaitlist(db, w)));
  assert.ok(results.every((r) => r === 'saved'));
  const [{ n }] = await db.query<{ n: string }>(`select count(*) as n from course_waitlist where phone = '07801112233'`);
  assert.equal(Number(n), 1);
});

test('the database itself refuses a live row with no phone, a bad phone, or a removed row that keeps a name', async () => {
  const ins = (cols: string, vals: string) => db.query(`insert into course_waitlist (consent_version, consented_at, ${cols}) values ('x', now(), ${vals})`);
  await assert.rejects(ins('guardian_name', `'اسم'`), /course_waitlist_live_has_phone/);
  await assert.rejects(ins('phone', `'0770'`), /check/);
  await assert.rejects(ins('phone, removed_at', `'07701110000', now()`), /course_waitlist_live_has_phone/);
  await assert.rejects(ins('guardian_name, removed_at', `'اسم', now()`), /course_waitlist_removed_is_blank/);
  await assert.rejects(ins('phone, age_band', `'07701110000', '2015'`), /check/);
});

// ---------------------------------------------------------------- caps

test('per-address caps: 5 an hour, 10 a day; another address is not affected', async () => {
  const ip = '198.51.100.7';
  for (let i = 0; i < MAX_WAITLIST_PER_IP_HOUR; i++) assert.equal(await allowWaitlist(db, ip), true, `attempt ${i + 1}`);
  assert.equal(await allowWaitlist(db, ip), false);
  assert.equal(await allowWaitlist(db, '198.51.100.8'), true);
  // An hour later the hourly cap is free again, but the day still counts.
  await db.query(`update waitlist_attempts set created_at = now() - interval '2 hours' where ip = $1`, [ip]);
  for (let i = MAX_WAITLIST_PER_IP_HOUR; i < MAX_WAITLIST_PER_IP_DAY; i++) assert.equal(await allowWaitlist(db, ip), true, `attempt ${i + 1}`);
  await db.query(`update waitlist_attempts set created_at = now() - interval '3 hours' where ip = $1`, [ip]);
  assert.equal(await allowWaitlist(db, ip), false, 'daily cap');
  // Rows older than a day are deleted, and the address is free again.
  await db.query(`update waitlist_attempts set created_at = now() - interval '25 hours' where ip = $1`, [ip]);
  assert.equal(await allowWaitlist(db, ip), true);
  const [{ n }] = await db.query<{ n: string }>(`select count(*) as n from waitlist_attempts where created_at < now() - interval '1 day'`);
  assert.equal(Number(n), 0);
});

test('parallel attempts from one address cannot pass the hourly cap', async () => {
  const ip = '198.51.100.9';
  const results = await Promise.all(Array.from({ length: 20 }, () => allowWaitlist(db, ip)));
  assert.equal(results.filter(Boolean).length, MAX_WAITLIST_PER_IP_HOUR);
});

test('site-wide daily ceiling: new numbers are refused, a repeat still gets the same answer', async () => {
  const [{ n }] = await db.query<{ n: string }>(`select count(*) as n from course_waitlist where created_at > now() - interval '24 hours'`);
  const fill = MAX_WAITLIST_NEW_PER_DAY - Number(n);
  await db.query(
    `insert into course_waitlist (phone, course_id, consent_version, consented_at)
     select '079' || lpad(g::text, 8, '0'), $1, 'x', now() from generate_series(1, $2::int) g`,
    [other, fill],
  );
  assert.equal(await joinWaitlist(db, clean({ phone: '07501112233' })), 'full');
  assert.equal(await joinWaitlist(db, clean({ courseId: String(closed) })), 'saved');
  // The next day the ceiling is free again.
  await db.query(`update course_waitlist set created_at = now() - interval '25 hours' where phone like '079%'`);
  assert.equal(await joinWaitlist(db, clean({ phone: '07501112233' })), 'saved');
  await db.query(`delete from course_waitlist where phone like '079%'`);
});

// ---------------------------------------------------------------- admin

test('the admin list is grouped by course interest and counts who is still waiting', async () => {
  const groups = await listWaitlist(db);
  assert.deepEqual(groups.map((g) => g.courseId), [null, closed, other]);
  assert.equal(groups[0].course, null);
  assert.equal(groups[1].course, 'دورة مسدودة');
  assert.equal(groups[1].waiting, 2);
  const counts = await waitingCounts(db);
  assert.equal(counts.byCourse.get(closed), 2);
  assert.equal(counts.any, 2);
});

test('«تم التبليغ» sets notified_at; a new request for the same course waits again', async () => {
  const [row] = await liveRows();
  assert.equal(await markNotified(db, adminId, Number(row.id)), true);
  assert.equal((await waitingCounts(db)).byCourse.get(closed), 1);
  assert.equal(await joinWaitlist(db, clean({ courseId: String(closed) })), 'saved');
  assert.equal((await waitingCounts(db)).byCourse.get(closed), 2);
  assert.equal(await markNotified(db, adminId, 999999), false);
});

test('«احذف» blanks the phone and the name; the audit log has the row id only', async () => {
  const [row] = await liveRows();
  assert.equal(await removeEntry(db, adminId, Number(row.id)), true);
  const [gone] = await db.query<{ phone: string | null; guardian_name: string | null; removed_at: Date | null }>('select phone, guardian_name, removed_at from course_waitlist where id = $1', [row.id]);
  assert.deepEqual({ phone: gone.phone, name: gone.guardian_name }, { phone: null, name: null });
  assert.ok(gone.removed_at);
  assert.equal(await removeEntry(db, adminId, Number(row.id)), false, 'twice is a no-op');
  assert.ok(!(await listWaitlist(db)).some((g) => g.entries.some((e) => e.id === Number(row.id))));
  const log = await db.query<{ action: string; target: string; detail: unknown }>(`select action, target, detail from audit_log where action like 'waitlist.%' order by id`);
  assert.deepEqual(log.map((l) => l.action), ['waitlist.notified', 'waitlist.removed']);
  assert.equal(log[1].target, `waitlist:${row.id}`);
  const whole = JSON.stringify(log);
  for (const s of ['0770', 'أبو علي']) assert.ok(!whole.includes(s), `audit log holds ${s}`);
  // After removal the number can join again, as a new entry.
  assert.equal(await joinWaitlist(db, clean({ courseId: String(closed) })), 'saved');
});

test(`numbers told more than ${WAITLIST_KEEP_DAYS} days ago are blanked; newer ones and those not told yet stay`, async () => {
  const rows = await liveRows();
  await db.query(`update course_waitlist set notified_at = now() - make_interval(days => $2) where id = $1`, [rows[0].id, WAITLIST_KEEP_DAYS + 1]);
  await db.query(`update course_waitlist set notified_at = now() - make_interval(days => $2) where id = $1`, [rows[1].id, WAITLIST_KEEP_DAYS - 1]);
  assert.equal(await purgeWaitlist(db), 1);
  const left = (await liveRows()).map((r) => r.id);
  assert.ok(!left.includes(rows[0].id));
  assert.ok(left.includes(rows[1].id));
  assert.equal(left.length, rows.length - 1);
});

test('the WhatsApp text: only when there is something open to tell, with the course and the link, never a phone or a name', () => {
  const origin = 'https://example.test';
  assert.equal(waitlistMessage({ course: 'دورة مسدودة', accepting: false }, true, origin), null);
  assert.equal(waitlistMessage({ course: null, accepting: false }, false, origin), null);
  const one = waitlistMessage({ course: 'دورة مفتوحة', accepting: true }, true, origin)!;
  assert.match(one, /«دورة مفتوحة»/);
  assert.ok(one.includes(`${origin}/register`) && !one.includes('%'), one);
  assert.match(one, /«إلغاء»/);
  const any = waitlistMessage({ course: null, accepting: false }, true, origin)!;
  assert.ok(any.includes(`${origin}/register`));
  assert.doesNotMatch(one + any, /07\d{9}/);
  assert.equal(waLink('0770 111 2233', 'نص'), `https://wa.me/9647701112233?text=${encodeURIComponent('نص')}`);
  assert.equal(waLink('12345', 'نص'), null);
});

test('opening a course moves its waiting people into the banner count with no change to their entries', async () => {
  assert.equal(await setCourseAccepting(db, adminId, closed, true), 'saved');
  assert.ok(!(await listWaitlistCourses(db)).some((c) => c.id === closed), 'an open course is no longer offered on the form');
  const g = (await listWaitlist(db)).find((x) => x.courseId === closed)!;
  assert.equal(g.accepting, true);
  assert.ok(waitlistMessage(g, true, 'https://example.test'));
  assert.ok(((await waitingCounts(db)).byCourse.get(closed) ?? 0) > 0);
});

// ---------------------------------------------------------------- access (static: the guards run before any data)

test('every waitlist admin action and the page check the admin session before touching the database', () => {
  const actions = readFileSync('app/admin/waitlist/actions.ts', 'utf8');
  const fns = [...actions.matchAll(/export async function (\w+)\([^)]*\) \{\n([^\n]*)/g)];
  assert.deepEqual(fns.map((m) => m[1]).sort(), ['waitlistNotifiedAction', 'waitlistRemoveAction']);
  for (const m of fns) assert.match(m[2], /^\s+const admin = await requireAdmin\(\);$/, m[1]);
  const page = readFileSync('app/admin/waitlist/page.tsx', 'utf8');
  const body = page.slice(page.indexOf('async function Waitlist()'));
  assert.ok(body.indexOf('await requireAdmin()') > 0 && body.indexOf('await requireAdmin()') < body.indexOf('getDb()'));
  // The public action stores nothing for the honeypot and reads no session.
  const pub = readFileSync('app/actions.ts', 'utf8');
  const wa = pub.slice(pub.indexOf('export async function waitlistAction'));
  assert.match(wa, /^export async function waitlistAction\([^)]*\)[^{]*\{\n\s+if \(text\(form, 'website'\)\) return \{ done: true \};/);
});

// ---------------------------------------------------------------- migration on a database already at 0007

test('0010 applies on a database at 0007 that already holds rows, and keeps them', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = await PGlite.create('memory://');
  type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (s: string) => Promise<unknown> };
  const wrap = (q: Q): Db => ({
    query: async <T,>(t: string, p?: unknown[]) => (await q.query(t, p)).rows as T[],
    exec: async (s) => void (await q.exec(s)),
    tx: (fn) => lite.transaction((t) => fn(wrap(t as unknown as Q))),
    close: () => lite.close(),
  }) as Db;
  const old = wrap(lite as unknown as Q);
  const dir = path.join(process.cwd(), 'db', 'migrations');
  await old.exec('create table schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql') && f < '0008').sort()) {
    await old.exec(readFileSync(path.join(dir, f), 'utf8'));
    await old.query('insert into schema_migrations (name) values ($1)', [f]);
  }
  const [c] = await old.query<{ id: number }>(`insert into courses (name, teacher, status, published) values ('دورة قديمة', 'أستاذ', 'open', false) returning id`);
  const [s] = await old.query<{ id: number }>(`insert into students (full_name, birth_year, phone, password_hash) values ('طالب قديم', 1990, '07701230000', 'x') returning id`);
  await old.query('insert into registrations (student_id, course_id) values ($1, $2)', [s.id, c.id]);

  assert.deepEqual((await old.query<{ name: string }>('select name from schema_migrations order by name')).map((r) => r.name).at(-1), '0007_second_course.sql');
  const applied = await migrate(old);
  assert.ok(applied.includes('0010_waitlist.sql') && !applied.includes('0007_second_course.sql'), applied.join());
  assert.equal((await old.query('select 1 from registrations')).length, 1);
  assert.equal((await old.query('select 1 from students')).length, 1);
  await old.query(`insert into course_waitlist (phone, course_id, consent_version, consented_at) values ('07701230000', $1, $2, now())`, [c.id, WAITLIST_CONSENT_VERSION]);
  assert.equal((await old.query('select 1 from course_waitlist')).length, 1);
  assert.deepEqual(await migrate(old), [], 'a second run applies nothing');
  await old.close();
});
