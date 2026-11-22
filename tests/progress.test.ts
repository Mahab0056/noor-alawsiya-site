// «المتابعة: حضور وملاحظة» (lib/progress.ts, migration 0011). In-memory PGlite or TEST_DATABASE_URL; invented data only.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { reviewRequest } from '@/lib/admin';
import { resetDbForTests, type Db } from '@/lib/db';
import { progressEnabled } from '@/lib/flags';
import {
  baghdadToday, cleanNote, deleteSession, getRoster, isDay, isTeacherRole, listRecordableCourses, listSessions, pupilProgress, recordAccess,
  saveAttendance, setCourseRecorder, weekStart, type EntryInput,
} from '@/lib/progress';
import { register, type RegistrationInput } from '@/lib/registration';

const YEAR = new Date().getFullYear();
// Sunday 22/11/2026 12:00 in Baghdad. Its week started on Saturday 21/11; Friday 20/11 is last week.
const NOW = new Date('2026-11-22T09:00:00Z');
const TODAY = '2026-11-22';

let db: Db;
let courseA: number;
let courseB: number;
let superId: number;
let teacherA: number; // assigned to A
let teacherB: number; // assigned to B only
let staffId: number; // staff, not assigned
let accepted1: number; // A, accepted, adult
let accepted2: number; // A, accepted, minor (guardian's phone)
let sibling: number; // same guardian phone as accepted2, accepted in B
let pendingA: number; // A, pending
let rejectedA: number; // A, rejected
let pupilB: number; // B, accepted

let seq = 0;
const phone = () => `0772${String(10000000 + ++seq).slice(1)}`;

async function pupil(courseId: number, over: Partial<RegistrationInput> = {}) {
  const r = await register(db, {
    fullName: `طالب تجريبي ${++seq}`, birthYear: String(YEAR - 25), phone: phone(), password: 'password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courseId), answers: {}, ...over,
  });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return { studentId: r.studentId, registrationId: r.registrationId };
}

const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params))[0].n);
const all = (ids: number[], status = 'present', note = ''): EntryInput[] => ids.map((studentId) => ({ studentId, status, note }));

before(async () => {
  db = await resetDbForTests();
  const course = async (name: string) => Number((await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ($1, 'tajweed', 'أستاذ تجريبي', true) returning id`, [name]))[0].id);
  courseA = await course('دورة الحضور أ');
  courseB = await course('دورة الحضور ب');
  superId = (await createAdmin(db, { name: 'مدير أعلى تجريبي', email: 'super-progress@example.test', password: 'a-long-test-password', role: 'super_admin' })).adminId;
  teacherA = (await createAdmin(db, { name: 'أستاذ أ', email: 'teacher-a@example.test', password: 'a-long-test-password', role: 'teacher' })).adminId;
  teacherB = (await createAdmin(db, { name: 'أستاذ ب', email: 'teacher-b@example.test', password: 'a-long-test-password', role: 'teacher' })).adminId;
  staffId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'staff-progress@example.test', password: 'a-long-test-password', role: 'staff' })).adminId;
  assert.equal(await setCourseRecorder(db, superId, courseA, teacherA, true), 'saved');
  assert.equal(await setCourseRecorder(db, superId, courseB, teacherB, true), 'saved');

  const a1 = await pupil(courseA);
  const guardian = { birthYear: String(YEAR - 11), guardianName: 'ولي أمر تجريبي', guardianPhone: '07801112233', guardianConsent: true };
  const a2 = await pupil(courseA, { ...guardian, phone: '07801112233', fullName: 'الابن الأول التجريبي', password: 'sibling-pass-1' });
  const sib = await pupil(courseB, { ...guardian, phone: '07801112233', fullName: 'الابن الثاني التجريبي', password: 'sibling-pass-2' });
  const pend = await pupil(courseA);
  const rej = await pupil(courseA);
  const b1 = await pupil(courseB);
  for (const r of [a1, a2, sib, b1]) assert.equal(await reviewRequest(db, superId, r.registrationId, 'accepted', ''), 'saved');
  assert.equal(await reviewRequest(db, superId, rej.registrationId, 'rejected', ''), 'saved');
  [accepted1, accepted2, sibling, pendingA, rejectedA, pupilB] = [a1, a2, sib, pend, rej, b1].map((r) => r.studentId);
});
after(async () => {
  await db.close();
});

// Nothing here may write to the console (children's data stays out of logs).
let logged: unknown[][] = [];
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
beforeEach(() => {
  logged = [];
  for (const k of Object.keys(original) as (keyof typeof original)[]) console[k] = (...args: unknown[]) => void logged.push(args);
});
afterEach(() => {
  Object.assign(console, original);
  assert.deepEqual(logged, [], 'nothing is logged');
});

test('migration 0011: tables, the teacher role, one session per course and day, notes capped by the database', async () => {
  const [{ role }] = await db.query<{ role: string }>('select role from admins where id = $1', [teacherA]);
  assert.equal(role, 'teacher');
  const [{ track }] = await db.query<{ track: string }>('select progress_track as track from courses where id = $1', [courseA]);
  assert.equal(track, 'attendance');
  const [{ id }] = await db.query<{ id: string }>(`insert into class_sessions (course_id, held_on) values ($1, '2020-01-04') returning id`, [courseB]);
  await assert.rejects(db.query(`insert into class_sessions (course_id, held_on) values ($1, '2020-01-04')`, [courseB]), /duplicate|unique/i);
  await assert.rejects(db.query(`insert into session_attendance (session_id, student_id, status, note) values ($1, $2, 'present', $3)`, [id, pupilB, 'x'.repeat(301)]), /check/i);
  await assert.rejects(db.query(`insert into session_attendance (session_id, student_id, status, note) values ($1, $2, 'present', '')`, [id, pupilB]), /check/i);
  await db.query('delete from class_sessions where id = $1', [id]);
});

test('the flag is off unless PROGRESS_TRACKING is exactly 1', () => {
  assert.equal(progressEnabled({}), false);
  assert.equal(progressEnabled({ PROGRESS_TRACKING: '0' }), false);
  assert.equal(progressEnabled({ PROGRESS_TRACKING: 'true' }), false);
  assert.equal(progressEnabled({ PROGRESS_TRACKING: '1' }), true);
  assert.equal(isTeacherRole('teacher'), true);
  for (const r of ['super_admin', 'owner', 'staff'] as const) assert.equal(isTeacherRole(r), false);
});

test('Baghdad dates: today, the Saturday week start, and strict day strings', () => {
  assert.equal(baghdadToday(new Date('2026-11-21T21:30:00Z')), '2026-11-22'); // 00:30 in Baghdad
  assert.equal(baghdadToday(new Date('2026-11-21T20:30:00Z')), '2026-11-21');
  for (const d of ['2026-11-21', '2026-11-22', '2026-11-25', '2026-11-27']) assert.equal(weekStart(d), '2026-11-21');
  assert.equal(weekStart('2026-11-20'), '2026-11-14');
  for (const bad of ['2026-02-30', '2026-11-2', '22/11/2026', '', null, 20261122]) assert.equal(isDay(bad), false);
  assert.equal(isDay('2024-02-29'), true);
});

test('the course teacher sees only the accepted pupils, by name only, and records them', async () => {
  const roster = await getRoster(db, teacherA, courseA, TODAY);
  assert.ok(roster);
  assert.deepEqual(roster.rows.map((r) => r.studentId).sort(), [accepted1, accepted2].sort());
  for (const r of roster.rows) assert.deepEqual(Object.keys(r).sort(), ['name', 'note', 'status', 'studentId']);
  assert.equal(roster.sessionId, null);

  const saved = await saveAttendance(db, teacherA, courseA, TODAY, [
    { studentId: accepted1, status: 'present', note: '  قرأ   سورة الملك   بإتقان  ' },
    { studentId: accepted2, status: 'absent', note: '' },
  ], NOW);
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.deepEqual({ p: saved.present, a: saved.absent, e: saved.excused, c: saved.changed }, { p: 1, a: 1, e: 0, c: 0 });
  const again = await getRoster(db, teacherA, courseA, TODAY);
  assert.equal(again?.sessionId, saved.sessionId);
  assert.equal(again?.rows.find((r) => r.studentId === accepted1)?.note, 'قرأ سورة الملك بإتقان');
  assert.equal(again?.rows.find((r) => r.studentId === accepted2)?.note, null);
  assert.deepEqual((await listRecordableCourses(db, teacherA)).map((c) => c.id), [courseA]);
});

test('a teacher of another course can neither read nor write this course', async () => {
  assert.equal(await recordAccess(db, teacherB, courseA), null);
  assert.equal(await getRoster(db, teacherB, courseA, TODAY), null);
  assert.deepEqual(await listSessions(db, teacherB, courseA), []);
  const before = await count('select count(*) as n from session_attendance');
  assert.deepEqual(await saveAttendance(db, teacherB, courseA, TODAY, all([accepted1], 'absent'), NOW), { ok: false, reason: 'forbidden' });
  // Their own course's pupil cannot be slipped into the other course either.
  assert.deepEqual(await saveAttendance(db, teacherB, courseB, TODAY, all([pupilB, accepted1]), NOW), { ok: false, reason: 'not-enrolled' });
  assert.equal(await count('select count(*) as n from session_attendance'), before);
  assert.deepEqual((await listRecordableCourses(db, teacherB)).map((c) => c.id), [courseB]);
});

test('pupils who are not accepted here are refused, and nothing of that save is written', async () => {
  const before = await count('select count(*) as n from session_attendance');
  for (const stranger of [pendingA, rejectedA, pupilB, sibling, 99999999]) {
    const r = await saveAttendance(db, teacherA, courseA, TODAY, all([accepted1, stranger]), NOW);
    assert.deepEqual(r, { ok: false, reason: 'not-enrolled' }, `student ${stranger}`);
  }
  assert.equal(await count('select count(*) as n from session_attendance'), before);
  assert.equal((await getRoster(db, teacherA, courseA, TODAY))?.rows.find((r) => r.studentId === accepted1)?.status, 'present');
  for (const bad of [[{ studentId: accepted1, status: 'late', note: '' }], [{ studentId: 'x', status: 'present', note: '' }], [...all([accepted1]), ...all([accepted1])]]) {
    assert.deepEqual(await saveAttendance(db, teacherA, courseA, TODAY, bad, NOW), { ok: false, reason: 'bad-input' });
  }
  assert.deepEqual(await saveAttendance(db, teacherA, courseA, TODAY, [], NOW), { ok: false, reason: 'empty' });
});

test('staff who are not assigned cannot record, and only a super admin assigns', async () => {
  assert.deepEqual(await saveAttendance(db, staffId, courseA, TODAY, all([accepted1]), NOW), { ok: false, reason: 'forbidden' });
  assert.equal(await setCourseRecorder(db, staffId, courseA, staffId, true), 'forbidden');
  assert.equal(await setCourseRecorder(db, teacherA, courseA, teacherB, true), 'forbidden');
  assert.equal(await setCourseRecorder(db, superId, courseA, superId, true), 'missing'); // super admins record everywhere already
  assert.equal(await setCourseRecorder(db, superId, courseA, staffId, true), 'saved');
  assert.ok(await recordAccess(db, staffId, courseA));
  assert.equal(await setCourseRecorder(db, superId, courseA, staffId, false), 'saved');
  assert.equal(await recordAccess(db, staffId, courseA), null);
});

test('a disabled teacher loses access at once', async () => {
  await db.query('update admins set disabled_at = now() where id = $1', [teacherB]);
  assert.equal(await recordAccess(db, teacherB, courseB), null);
  assert.deepEqual(await listRecordableCourses(db, teacherB), []);
  await db.query('update admins set disabled_at = null where id = $1', [teacherB]);
});

test('dates: a teacher writes this week up to today; a super admin also earlier days; nobody a future day', async () => {
  assert.deepEqual(await saveAttendance(db, teacherA, courseA, '2026-11-23', all([accepted1]), NOW), { ok: false, reason: 'future' });
  assert.deepEqual(await saveAttendance(db, teacherA, courseA, '2026-11-20', all([accepted1]), NOW), { ok: false, reason: 'locked' });
  assert.deepEqual(await saveAttendance(db, teacherA, courseA, '2026-02-30', all([accepted1]), NOW), { ok: false, reason: 'bad-date' });
  assert.ok((await saveAttendance(db, teacherA, courseA, '2026-11-21', all([accepted1, accepted2]), NOW)).ok);
  assert.ok((await saveAttendance(db, superId, courseA, '2026-11-18', [...all([accepted1], 'excused', 'سفر مع الأهل'), ...all([accepted2])], NOW)).ok);
  assert.deepEqual(await saveAttendance(db, superId, courseA, '2025-11-01', all([accepted1]), NOW), { ok: false, reason: 'bad-date' });
  assert.deepEqual(
    (await listSessions(db, superId, courseA)).map((s) => [s.day, s.present, s.absent, s.excused]),
    [['2026-11-22', 1, 1, 0], ['2026-11-21', 2, 0, 0], ['2026-11-18', 1, 0, 1]]
  );
});

test('notes: one line, at most 300 characters, empty means none', async () => {
  assert.equal(cleanNote(' a \n\n b\t'), 'a b');
  assert.equal(cleanNote('   '), null);
  assert.equal(cleanNote(undefined), null);
  const long = await saveAttendance(db, teacherA, courseA, TODAY, [{ studentId: accepted1, status: 'present', note: 'ن'.repeat(301) }], NOW);
  assert.deepEqual(long, { ok: false, reason: 'note-long', studentId: accepted1 });
  assert.ok((await saveAttendance(db, teacherA, courseA, TODAY, [{ studentId: accepted1, status: 'present', note: 'ن'.repeat(300) }], NOW)).ok);
});

test('a correction is counted as a change, and unchanged rows are left alone', async () => {
  const r = await saveAttendance(db, teacherA, courseA, TODAY, [
    { studentId: accepted1, status: 'present', note: 'قرأ سورة الملك بإتقان' },
    { studentId: accepted2, status: 'excused', note: '' },
  ], NOW);
  assert.ok(r.ok);
  assert.equal(r.changed, 2); // note of 1 back to the short one, status of 2
  const same = await saveAttendance(db, teacherA, courseA, TODAY, [{ studentId: accepted2, status: 'excused', note: '' }], NOW);
  assert.ok(same.ok);
  assert.equal(same.changed, 0);
});

test('«حسابي»: each pupil sees only their own rows, through an accepted request', async () => {
  const mine = await pupilProgress(db, accepted1);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].courseId, courseA);
  assert.deepEqual(mine[0].sessions.map((s) => [s.day, s.status]), [['2026-11-22', 'present'], ['2026-11-21', 'present'], ['2026-11-18', 'excused']]);
  assert.deepEqual([mine[0].present, mine[0].absent, mine[0].excused], [2, 0, 1]);
  assert.equal(mine[0].sessions[0].note, 'قرأ سورة الملك بإتقان');
  assert.equal(mine[0].sessions[2].note, 'سفر مع الأهل');

  // The minor's sibling on the same guardian phone is another account: their course has no rows, and nothing of the brother's shows.
  const sib = await pupilProgress(db, sibling);
  assert.deepEqual(sib.map((c) => [c.courseId, c.sessions.length]), [[courseB, 0]]);
  // Not accepted: no course at all.
  assert.deepEqual(await pupilProgress(db, pendingA), []);
  assert.deepEqual(await pupilProgress(db, rejectedA), []);
  const whole = JSON.stringify(await pupilProgress(db, accepted2));
  assert.ok(!whole.includes('سورة الملك') && !whole.includes('سفر'), 'another pupil’s note leaked');
});

test('rejecting an accepted request hides that course’s record at once', async () => {
  const [{ id }] = await db.query<{ id: string }>(`select id from registrations where student_id = $1 and course_id = $2`, [accepted2, courseA]);
  assert.equal((await pupilProgress(db, accepted2)).length, 1);
  assert.equal(await reviewRequest(db, superId, Number(id), 'rejected', ''), 'saved');
  assert.deepEqual(await pupilProgress(db, accepted2), []);
  assert.ok(!(await getRoster(db, teacherA, courseA, TODAY))?.rows.some((r) => r.studentId === accepted2));
  assert.equal(await reviewRequest(db, superId, Number(id), 'accepted', ''), 'saved');
  assert.equal((await pupilProgress(db, accepted2))[0].sessions.length, 3);
});

test('only a super admin deletes a session, and its rows go with it', async () => {
  assert.equal(await deleteSession(db, teacherA, courseA, '2026-11-18'), 'forbidden');
  assert.equal(await deleteSession(db, superId, courseA, '2026-11-17'), 'missing');
  assert.equal(await deleteSession(db, superId, courseA, '2026-11-18'), 'deleted');
  assert.deepEqual((await pupilProgress(db, accepted1))[0].sessions.map((s) => s.day), ['2026-11-22', '2026-11-21']);
});

test('deleting a pupil deletes their attendance', async () => {
  const extra = await pupil(courseB);
  const [{ id }] = await db.query<{ id: string }>(`select id from registrations where student_id = $1`, [extra.studentId]);
  await reviewRequest(db, superId, Number(id), 'accepted', '');
  assert.ok((await saveAttendance(db, teacherB, courseB, TODAY, all([extra.studentId, pupilB]), NOW)).ok);
  await db.query('delete from students where id = $1', [extra.studentId]);
  assert.equal(await count('select count(*) as n from session_attendance where student_id = $1', [extra.studentId]), 0);
});

test('the audit log holds ids and counts, never names or note text', async () => {
  const rows = await db.query<{ action: string; target: string; detail: unknown }>(`select action, target, detail from audit_log where action like 'attendance.%' or action like 'course.teacher.%' order by id`);
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ['attendance.save', 'attendance.edit', 'attendance.delete', 'course.teacher.add', 'course.teacher.remove']) assert.ok(actions.has(a), a);
  const whole = JSON.stringify(rows);
  for (const s of ['قرأ', 'سفر', 'طالب تجريبي', 'الابن', '0780', 'دورة الحضور', 'أستاذ']) assert.ok(!whole.includes(s), `audit log holds ${s}`);
});

test('only the «الحضور» screens accept a teacher session (requireRecorder); every other admin screen uses requireAdmin', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(path.join(process.cwd(), 'app'));
  walk(path.join(process.cwd(), 'components'));
  for (const f of files) {
    if (!readFileSync(f, 'utf8').includes('requireRecorder')) continue;
    assert.ok(f.includes(path.join('app', 'admin', 'progress')), `${f} accepts a teacher session`);
  }
  const session = readFileSync(path.join(process.cwd(), 'lib', 'session.ts'), 'utf8');
  assert.match(session, /isTeacherRole\(admin\.role\) \? redirect\('\/admin\/progress'\)/);
});
