// awsiya-review-progress-build-2220r: one attack test per fix of the review of 79bc5ce. Invented data only, in-memory
// PGlite or TEST_DATABASE_URL (a local throwaway Postgres).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { reviewRequest } from '@/lib/admin';
import { resetDbForTests, type Db } from '@/lib/db';
import * as P from '@/lib/progress';
import { register } from '@/lib/registration';

const YEAR = new Date().getFullYear();
const NOW = new Date('2026-11-22T09:00:00Z'); // Sunday in Baghdad
const TODAY = '2026-11-22';

let db: Db;
let course: number;
let teacher: number;
const pupils: number[] = [];

before(async () => {
  db = await resetDbForTests();
  course = Number((await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة المراجعة', 'tajweed', 'أستاذ تجريبي', true) returning id`))[0].id);
  const superId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'super-review@example.test', password: 'a-long-test-password', role: 'super_admin' })).adminId;
  teacher = (await createAdmin(db, { name: 'أستاذ تجريبي', email: 'teacher-review@example.test', password: 'a-long-test-password', role: 'teacher' })).adminId;
  assert.equal(await P.setCourseRecorder(db, superId, course, teacher, true), 'saved');
  for (let i = 0; i < 3; i++) {
    const r = await register(db, {
      fullName: `طالب المراجعة ${i}`, birthYear: String(YEAR - 25), phone: `0773000000${i}`, password: 'password-1',
      guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(course), answers: {},
    });
    assert.ok(r.ok);
    assert.equal(await reviewRequest(db, superId, r.registrationId, 'accepted', ''), 'saved');
    pupils.push(r.studentId);
  }
});
after(async () => {
  await db.close();
});

// ---------------------------------------------------------------- M3: which pupil's record was edited, and by whom

test('review M3: an edit names the pupils whose mark or note changed in the audit log (ids only)', async () => {
  const [p1, p2, p3] = pupils;
  const first = await P.saveAttendance(db, teacher, course, TODAY, [
    { studentId: p1, status: 'present', note: 'ملاحظة أولى' },
    { studentId: p2, status: 'absent', note: '' },
    { studentId: p3, status: 'present', note: '' },
  ], NOW);
  assert.ok(first.ok);
  // The attack: a note a guardian may already have read is rewritten, another pupil's mark flipped, one row left alone.
  const edit = await P.saveAttendance(db, teacher, course, TODAY, [
    { studentId: p1, status: 'present', note: 'نص آخر' },
    { studentId: p2, status: 'present', note: '' },
    { studentId: p3, status: 'present', note: '' },
  ], NOW);
  assert.ok(edit.ok);
  const rows = await db.query<{ action: string; admin_id: string; detail: { students?: number[] } }>(`select action, admin_id, detail from audit_log where action like 'attendance.%' order by id`);
  const save = rows.find((r) => r.action === 'attendance.save');
  const change = rows.find((r) => r.action === 'attendance.edit');
  assert.ok(save && change);
  assert.equal(Number(change.admin_id), teacher);
  assert.deepEqual(change.detail.students, [p1, p2].sort((a, b) => a - b), 'the edit names the two pupils it changed');
  assert.deepEqual(save.detail.students, [p1, p2, p3].sort((a, b) => a - b), 'the first save names who it wrote');
  // Still no names and no note text.
  const whole = JSON.stringify(rows);
  for (const s of ['ملاحظة أولى', 'نص آخر', 'طالب المراجعة']) assert.ok(!whole.includes(s), `audit log holds ${s}`);
});

// ---------------------------------------------------------------- L1: counted nouns and the adjective agree with the number

test('review L1: the roster heading agrees with the number («طالب واحد مقبول», «طالبان مقبولان», «١١ طالباً مقبولاً»)', () => {
  const f = (P as Record<string, unknown>).acceptedText;
  assert.equal(typeof f, 'function', 'lib/progress.ts acceptedText');
  const acceptedText = f as (n: number) => string;
  assert.deepEqual([1, 2, 3, 10, 11, 99, 100, 101, 103, 111].map(acceptedText), [
    'طالب واحد مقبول', 'طالبان مقبولان', '٣ طلاب مقبولون', '١٠ طلاب مقبولون', '١١ طالباً مقبولاً', '٩٩ طالباً مقبولاً',
    '١٠٠ طالب مقبول', '١٠١ طالب مقبول', '١٠٣ طلاب مقبولون', '١١١ طالباً مقبولاً',
  ]);
  assert.equal(P.pupilsText(100), '١٠٠ طالب', '«١٠٠ طالباً» is wrong');
});

test('review L1: the «حسابي» summary agrees with the number and has no gendered verb', () => {
  const f = (P as Record<string, unknown>).attendedText;
  assert.equal(typeof f, 'function', 'lib/progress.ts attendedText');
  const attendedText = f as (name: string, present: number, total: number) => string;
  assert.equal(attendedText('مريم', 0, 1), 'حضور مريم: ٠ من حلقة واحدة مسجّلة.');
  assert.equal(attendedText('مريم', 1, 2), 'حضور مريم: ١ من حلقتين مسجّلتين.');
  assert.equal(attendedText('حسين', 3, 7), 'حضور حسين: ٣ من ٧ حلقات مسجّلة.');
  assert.equal(attendedText('حسين', 9, 12), 'حضور حسين: ٩ من ١٢ حلقة مسجّلة.');
  const page = readFileSync(path.join(process.cwd(), 'app', 'account', 'page.tsx'), 'utf8');
  assert.ok(!/حضر \{firstName\}|'حلقات مسجّلة'/.test(page), '«حسابي» still builds the sentence itself');
});

// ---------------------------------------------------------------- M1: /privacy must follow the running flag, not the build

test('review M1: /privacy reads PROGRESS_TRACKING per request (after connection()), so it is not frozen into the build', () => {
  const src = readFileSync(path.join(process.cwd(), 'app', 'privacy', 'page.tsx'), 'utf8');
  const calls = src.split('progressEnabled()').length - 1;
  assert.ok(calls >= 1, 'the page still reads the flag');
  // Every read of the flag sits in an async component that first awaits connection(); with cacheComponents a page
  // without it is prerendered once at build time with whatever PROGRESS_TRACKING the build had.
  const guarded = src.match(/async function \w+\([^)]*\)[^{]*\{\s*await connection\(\);[^]*?progressEnabled\(\)/g) ?? [];
  assert.equal(guarded.length, calls, 'progressEnabled() is read only after await connection()');
  assert.match(src, /<Suspense/);
});
