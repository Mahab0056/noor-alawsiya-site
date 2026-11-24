// «كشف الدورة» (flag COURSE_ROSTER): accepted students only, one course only, sorted by name, an audit row per open,
// no-store / noindex, 404 while OFF, and no file export anywhere. Invented data only.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server';
import { createAdmin } from '@/lib/accounts';
import { reviewRequest } from '@/lib/admin';
import { resetDbForTests, type Db } from '@/lib/db';
import { register } from '@/lib/registration';
import { ATTENDANCE_BOXES, getRoster, recordRosterView } from '@/lib/roster';
import { courseRosterOn, isRosterPath, rosterHref } from '@/lib/roster-flag';
import { proxy } from '../proxy';

const YEAR = new Date().getFullYear();
let db: Db;
let adminId: number;
let courseA: number;
let courseB: number;
let empty: number;
let phoneN = 0;

async function student(courseId: number, fullName: string, minor: boolean, decision: 'accepted' | 'rejected' | 'pending') {
  phoneN += 1;
  const r = await register(db, {
    fullName, birthYear: String(minor ? YEAR - 12 : YEAR - 30), phone: `0770999${String(phoneN).padStart(4, '0')}`, password: 'password-1',
    guardianName: minor ? `ولي ${fullName}` : '', guardianPhone: minor ? `0780888${String(phoneN).padStart(4, '0')}` : '', guardianConsent: minor,
    courseId: String(courseId), answers: {},
  });
  assert.ok(r.ok, JSON.stringify(r));
  if (decision !== 'pending') assert.equal(await reviewRequest(db, adminId, r.registrationId, decision, ''), 'saved');
}

before(async () => {
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'roster@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  const add = async (name: string, teacher: string) =>
    Number((await db.query<{ id: string }>(`insert into courses (name, teacher, status, published) values ($1, $2, 'open', true) returning id`, [name, teacher]))[0].id);
  courseA = await add('دورة الخط', 'أستاذ تجريبي');
  courseB = await add('دورة الرسم', 'أستاذة تجريبية');
  empty = await add('دورة بلا طلاب', ' ');
  await student(courseA, 'يوسف تجريبي', true, 'accepted');
  await student(courseA, 'أحمد تجريبي', false, 'accepted');
  await student(courseA, 'زينب تجريبية', true, 'accepted');
  await student(courseA, 'مريم مرفوضة', true, 'rejected');
  await student(courseA, 'علي منتظر', true, 'pending');
  await student(courseB, 'سارة من دورة أخرى', true, 'accepted');
  await student(courseB, 'باسم من دورة أخرى', false, 'pending');
});
after(async () => {
  await db.close();
});

test('only accepted students of the course, sorted by name, with age group and guardian', async () => {
  const r = await getRoster(db, courseA, YEAR);
  assert.ok(r);
  assert.equal(r.courseName, 'دورة الخط');
  assert.equal(r.teacher, 'أستاذ تجريبي');
  assert.deepEqual(r.students.map((s) => s.studentName), ['أحمد تجريبي', 'زينب تجريبية', 'يوسف تجريبي']);
  const [adult, minor] = r.students;
  assert.deepEqual(adult, { studentName: 'أحمد تجريبي', ageGroup: 'adult', guardianName: null, guardianPhone: null });
  assert.equal(minor.ageGroup, 'minor');
  assert.equal(minor.guardianName, 'ولي زينب تجريبية');
  assert.match(minor.guardianPhone ?? '', /^0780888\d{4}$/);
  // Rejected and waiting requests never appear.
  const names = r.students.map((s) => s.studentName).join('|');
  assert.doesNotMatch(names, /مرفوضة|منتظر/);
});

test("another course's students never appear", async () => {
  const a = await getRoster(db, courseA, YEAR);
  const b = await getRoster(db, courseB, YEAR);
  assert.ok(a && b);
  assert.ok(!a.students.some((s) => s.studentName.includes('دورة أخرى')));
  assert.deepEqual(b.students.map((s) => s.studentName), ['سارة من دورة أخرى']);
});

test('a re-decided request leaves the list (accepted, then rejected)', async () => {
  const [{ id }] = await db.query<{ id: string }>(
    `select r.id from registrations r join students s on s.id = r.student_id where s.full_name = 'يوسف تجريبي' and r.course_id = $1`, [courseA]);
  assert.equal(await reviewRequest(db, adminId, Number(id), 'rejected', ''), 'saved');
  assert.ok(!(await getRoster(db, courseA, YEAR))?.students.some((s) => s.studentName === 'يوسف تجريبي'));
  assert.equal(await reviewRequest(db, adminId, Number(id), 'accepted', ''), 'saved');
});

test('an empty course gives an empty list and no teacher line; an unknown course gives null', async () => {
  const e = await getRoster(db, empty, YEAR);
  assert.deepEqual(e && { students: e.students, teacher: e.teacher }, { students: [], teacher: null });
  assert.equal(await getRoster(db, 999999, YEAR), null);
});

test('every open writes an audit row: who, which course, when; no names or phones', async () => {
  const before = Date.now() - 60_000;
  await recordRosterView(db, adminId, courseA);
  await recordRosterView(db, adminId, courseA);
  const rows = await db.query<{ admin_id: string; action: string; target: string; detail: unknown; created_at: Date }>(
    `select admin_id, action, target, detail, created_at from audit_log where action = 'course.roster_viewed' order by id`);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(Number(row.admin_id), adminId);
    assert.equal(row.target, `course:${courseA}`);
    assert.equal(row.detail, null);
    assert.ok(new Date(row.created_at).getTime() >= before);
  }
});

test('the page checks the admin and the flag before it reads the list, and audits before it shows it', () => {
  const src = readFileSync('app/admin/courses/[id]/roster/page.tsx', 'utf8');
  const body = src.slice(src.indexOf('async function RosterView('));
  const guard = body.indexOf('await requireAdmin()');
  const flag = body.indexOf('courseRosterOn()');
  assert.ok(guard > 0 && flag > guard);
  for (const call of ['getDb(', 'getRoster(', 'recordRosterView(']) assert.ok(body.indexOf(call) > flag, call);
  assert.ok(body.indexOf('recordRosterView(') < body.indexOf('return ('));
  assert.match(src, /robots: \{ index: false, follow: false \}/);
  assert.equal(ATTENDANCE_BOXES, 8);
});

// ---------------------------------------------------------------- flag, proxy, headers

test('flag COURSE_ROSTER: OFF unless 1 / true / on', () => {
  for (const v of [undefined, '', '0', 'false', 'off', 'yes']) assert.equal(courseRosterOn({ COURSE_ROSTER: v }), false, String(v));
  for (const v of ['1', 'true', 'ON', ' on ']) assert.equal(courseRosterOn({ COURSE_ROSTER: v }), true, v);
  assert.ok(isRosterPath(rosterHref(12)));
  assert.ok(isRosterPath('/admin/courses/12/roster/'));
  for (const p of ['/admin/courses', '/admin/courses/12', '/admin/courses/12/roster/x', '/admin/courses/12/roster.csv', '/admin/roster']) assert.ok(!isRosterPath(p), p);
});

function call(path: string, cookie?: string) {
  return proxy(new NextRequest(`http://localhost:8080${path}`, { headers: cookie ? { host: 'noor-alawsiya.com', cookie } : { host: 'noor-alawsiya.com' } }));
}
function withFlag<T>(value: string | undefined, fn: () => T): T {
  const old = process.env.COURSE_ROSTER;
  if (value === undefined) delete process.env.COURSE_ROSTER;
  else process.env.COURSE_ROSTER = value;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.COURSE_ROSTER;
    else process.env.COURSE_ROSTER = old;
  }
}

test('no admin cookie: redirected to the admin login, flag ON or OFF (as other admin pages)', () => {
  for (const v of [undefined, '1']) {
    withFlag(v, () => assert.match(call(rosterHref(courseA)).headers.get('location') ?? '', /\/admin\/login$/));
  }
});

test('flag OFF: the roster address is rewritten to an address with no route (404 before any render)', () => {
  withFlag(undefined, () => {
    const res = call(rosterHref(courseA), 'noor_a=x');
    assert.match(res.headers.get('x-middleware-rewrite') ?? '', /\/_roster-off$/);
    assert.ok(!existsSync('app/_roster-off') && !existsSync('app/[slug]'), 'no route may ever match the OFF target');
    assert.equal(res.headers.get('cache-control'), null);
  });
});

test('flag ON: Cache-Control no-store and X-Robots-Tag noindex on the roster, nothing added elsewhere', () => {
  withFlag('1', () => {
    const res = call(rosterHref(courseA), 'noor_a=x');
    assert.equal(res.headers.get('x-middleware-rewrite'), null);
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
    const other = call('/admin/courses', 'noor_a=x');
    assert.equal(other.headers.get('cache-control'), null);
    assert.equal(other.headers.get('x-robots-tag'), null);
  });
});

// ---------------------------------------------------------------- paper only: no file export

test('no CSV, no PDF, no file route: the roster folder has only the page and its CSS, and nothing sends a file', () => {
  const dir = 'app/admin/courses/[id]/roster';
  assert.deepEqual(readdirSync(dir).sort(), ['page.tsx', 'roster.css']);
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk('app');
  walk('lib');
  walk('components');
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!/roster/i.test(src)) continue;
    assert.doesNotMatch(src, /text\/csv|application\/pdf|Content-Disposition|\.csv\b|download=/i, f);
  }
  assert.ok(!existsSync('app/admin/courses/[id]/roster/route.ts'));
});
