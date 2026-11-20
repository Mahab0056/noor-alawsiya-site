// A signed-in student asks for another course from «حسابي» (lib/course-requests.ts, 0007). In-memory PGlite, invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { countRequests, getRequest, listRequests, reviewRequest } from '@/lib/admin';
import { courseRequestContext, maskName, MAX_ACCOUNT_REQUESTS_PER_DAY, requestCourse, type CourseRequestInput } from '@/lib/course-requests';
import { resetDbForTests, type Db } from '@/lib/db';
import { listStudentRegistrations, register, type RegistrationInput } from '@/lib/registration';

let db: Db;
let adminId: number;
let courses: number[]; // open, published
let closedCourse: number;
let hiddenCourse: number;

const YEAR = new Date().getFullYear();
let phoneSeq = 0;
const phone = () => `0771${String(10000000 + ++phoneSeq).slice(1)}`;

before(async () => {
  db = await resetDbForTests();
  courses = [];
  for (let i = 1; i <= 6; i++) {
    const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ($1, 'tajweed', 'أستاذ تجريبي', true) returning id`, [`دورة تجريبية ${i}`]);
    courses.push(Number(c.id));
  }
  const [closed] = await db.query<{ id: string }>(`insert into courses (name, teacher, published, status) values ('دورة منتهية', 'أستاذ تجريبي', true, 'done') returning id`);
  closedCourse = Number(closed.id);
  const [hidden] = await db.query<{ id: string }>(`insert into courses (name, teacher, published) values ('دورة غير منشورة', 'أستاذ تجريبي', false) returning id`);
  hiddenCourse = Number(hidden.id);
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'second-course@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
});
after(async () => {
  await db.close();
});

// Nothing in this feature may write to the console or the audit log (children's data stays out of logs).
let logged: unknown[][] = [];
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
beforeEach(() => {
  logged = [];
  for (const k of Object.keys(original) as (keyof typeof original)[]) console[k] = (...args: unknown[]) => void logged.push(args);
});
afterEach(() => void Object.assign(console, original));

async function student(over: Partial<RegistrationInput> = {}) {
  const r = await register(db, {
    fullName: `طالب تجريبي ${++phoneSeq}`, birthYear: String(YEAR - 25), phone: phone(), password: 'password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courses[0]), answers: {},
    ...over,
  });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return r.studentId;
}
const minorStudent = () => student({ birthYear: String(YEAR - 12), guardianName: 'جاسم محمد علي', guardianPhone: '07801234567', guardianConsent: true });
const ask = (studentId: number, over: Partial<CourseRequestInput> = {}) => requestCourse(db, studentId, { courseId: String(courses[1]), note: '', guardianConsent: false, ...over });
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params))[0].n);

test('migration 0007: one live request per student and course, enforced by the database', async () => {
  const [idx] = await db.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'registrations_one_live_idx'`);
  assert.match(idx.indexdef, /UNIQUE INDEX .* \(student_id, course_id\) WHERE \(status = ANY/);
  const s = await student();
  // A second pending row for the same course is refused even when the application check is bypassed.
  await assert.rejects(db.query('insert into registrations (student_id, course_id) values ($1, $2)', [s, courses[0]]), /unique|duplicate/i);
  // After a rejection the course can be asked for again.
  await db.query(`update registrations set status = 'rejected' where student_id = $1`, [s]);
  await db.query('insert into registrations (student_id, course_id) values ($1, $2)', [s, courses[0]]);
  await assert.rejects(db.query(`insert into registrations (student_id, course_id, origin) values ($1, $2, 'elsewhere')`, [s, courses[2]]), /check/i);
  await assert.rejects(db.query(`insert into registrations (student_id, course_id, student_note) values ($1, $2, $3)`, [s, courses[2], 'x'.repeat(301)]), /check/i);
});

test('adult: asks for a second course without typing their details; no new student row', async () => {
  const s = await student();
  const studentsBefore = await count('select count(*) as n from students');
  const ctx = await courseRequestContext(db, s);
  assert.equal(ctx?.minor, false);
  assert.equal(ctx?.guardianMasked, null);
  assert.equal(ctx?.leftToday, MAX_ACCOUNT_REQUESTS_PER_DAY);
  assert.deepEqual(ctx?.courses.find((c) => c.id === courses[0])?.taken, 'pending', 'the course from the registration form shows as pending');

  const r = await ask(s, { note: '  أفضّل الحلقة المسائية  ' });
  assert.ok(r.ok);
  assert.equal(await count('select count(*) as n from students'), studentsBefore);
  const [row] = await db.query<{ student_id: string; origin: string; student_note: string; guardian_consent_at: Date | null; status: string }>(
    'select student_id, origin, student_note, guardian_consent_at, status from registrations where id = $1', [r.registrationId]);
  assert.deepEqual({ ...row, student_id: Number(row.student_id) }, { student_id: s, origin: 'account', student_note: 'أفضّل الحلقة المسائية', guardian_consent_at: null, status: 'pending' });
  assert.equal((await listStudentRegistrations(db, s)).length, 2);
  assert.equal(await count('select count(*) as n from audit_log'), 0, 'no audit row for a student request');
  assert.deepEqual(logged, [], 'nothing written to the console');
});

test('minor: the guardian on file is shown masked and must agree to this request; the tick time is stored', async () => {
  const s = await minorStudent();
  const ctx = await courseRequestContext(db, s);
  assert.equal(ctx?.minor, true);
  assert.equal(ctx?.guardianMasked, 'ج… م… ع…');
  assert.ok(!ctx?.guardianMasked?.includes('جاسم'));

  const refused = await ask(s);
  assert.ok(!refused.ok && refused.errors.guardianConsent);
  assert.equal((await listStudentRegistrations(db, s)).length, 1, 'nothing stored without the agreement');

  const t0 = Date.now();
  const r = await ask(s, { guardianConsent: true });
  assert.ok(r.ok);
  const [row] = await db.query<{ guardian_consent_at: Date }>('select guardian_consent_at from registrations where id = $1', [r.registrationId]);
  assert.ok(new Date(row.guardian_consent_at).getTime() >= t0 - 1000);
  const [g] = await db.query<{ n: string }>('select count(*) as n from students where guardian_name = $1', ['جاسم محمد علي']);
  assert.equal(Number(g.n), 1, 'the guardian is reused, not copied');
  assert.deepEqual(logged, []);
});

test('an adult needs no guardian tick, and one sent anyway is not stored', async () => {
  const s = await student();
  const r = await ask(s, { guardianConsent: true });
  assert.ok(r.ok);
  const [row] = await db.query<{ guardian_consent_at: Date | null }>('select guardian_consent_at from registrations where id = $1', [r.registrationId]);
  assert.equal(row.guardian_consent_at, null);
});

test("the request is stored for the session's student only; a forged student id is ignored", async () => {
  const victim = await student();
  const attacker = await student();
  // The action passes requireStudent().id; extra fields such as a student id are not part of the input and are dropped.
  const forged = { courseId: String(courses[2]), note: '', guardianConsent: false, studentId: String(victim) } as CourseRequestInput;
  const r = await requestCourse(db, attacker, forged);
  assert.ok(r.ok);
  const [row] = await db.query<{ student_id: string }>('select student_id from registrations where id = $1', [r.registrationId]);
  assert.equal(Number(row.student_id), attacker);
  assert.equal((await listStudentRegistrations(db, victim)).length, 1, "the victim's requests are untouched");

  // And the Server Action reads the student from the session, never from the form.
  const src = readFileSync('app/actions.ts', 'utf8');
  const body = src.slice(src.indexOf('export async function requestCourseAction'), src.indexOf('export async function logoutAction'));
  assert.match(body, /const student = await requireStudent\(\);/);
  assert.match(body, /requestCourse\(await getDb\(\), student\.id, \{/);
  assert.doesNotMatch(body, /studentId|form\.get\('id'\)|text\(form, 'id'\)/);
});

test('a duplicate pending request is refused with a friendly message', async () => {
  const s = await student();
  assert.ok((await ask(s)).ok);
  const again = await ask(s);
  assert.ok(!again.ok);
  assert.equal(again.errors.courseId, 'لديك طلب قيد المراجعة لهذه الدورة. ستظهر النتيجة في حسابك.');
  // The course from the registration form counts too.
  const first = await ask(s, { courseId: String(courses[0]) });
  assert.ok(!first.ok && first.errors.courseId);
});

test('two identical requests at the same moment: exactly one is stored', async () => {
  const s = await student();
  const rs = await Promise.all([ask(s), ask(s)]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.ok(rs.some((r) => !r.ok && r.errors.courseId));
  assert.equal(await count(`select count(*) as n from registrations where student_id = $1 and course_id = $2`, [s, courses[1]]), 1);

  const s2 = await student();
  const burst = await Promise.all(Array.from({ length: 10 }, () => ask(s2, { courseId: String(courses[3]) })));
  assert.equal(burst.filter((r) => r.ok).length, 1);
});

test(`daily cap: ${MAX_ACCOUNT_REQUESTS_PER_DAY} requests from the account in 24 hours, also when sent at once`, async () => {
  const s = await student();
  for (const c of courses.slice(1, 1 + MAX_ACCOUNT_REQUESTS_PER_DAY)) assert.ok((await ask(s, { courseId: String(c) })).ok);
  const over = await ask(s, { courseId: String(courses[4]) });
  assert.ok(!over.ok);
  assert.match(over.errors.form, /الحد اليومي/);
  assert.equal((await courseRequestContext(db, s))?.leftToday, 0);
  // A day later the student can ask again.
  await db.query(`update registrations set created_at = created_at - interval '25 hours' where student_id = $1`, [s]);
  assert.ok((await ask(s, { courseId: String(courses[4]) })).ok);

  const s2 = await student();
  const burst = await Promise.all(courses.slice(1).map((c) => ask(s2, { courseId: String(c) })));
  assert.equal(burst.filter((r) => r.ok).length, MAX_ACCOUNT_REQUESTS_PER_DAY, 'five at once: only the cap is stored');
});

test('an accepted course cannot be asked for again; a rejected one can', async () => {
  const s = await student();
  const [reg] = await db.query<{ id: string }>('select id from registrations where student_id = $1', [s]);
  assert.equal(await reviewRequest(db, adminId, Number(reg.id), 'accepted', ''), 'saved');
  const r = await ask(s, { courseId: String(courses[0]) });
  assert.ok(!r.ok);
  assert.equal(r.errors.courseId, 'أنت مقبول في هذه الدورة من قبل.');
  assert.equal((await courseRequestContext(db, s))?.courses.find((c) => c.id === courses[0])?.taken, 'accepted');

  const other = await ask(s);
  assert.ok(other.ok);
  assert.equal(await reviewRequest(db, adminId, other.registrationId, 'rejected', ''), 'saved');
  const retry = await ask(s);
  assert.ok(retry.ok, 'a rejected course can be asked for again');

  // Accepting the old rejected request while the new one is pending would make two live requests: refused, not a crash.
  assert.equal(await reviewRequest(db, adminId, other.registrationId, 'accepted', ''), 'conflict');
  const [old] = await db.query<{ status: string }>('select status from registrations where id = $1', [other.registrationId]);
  assert.equal(old.status, 'rejected');
});

test('closed, unpublished and unknown courses, and a long note, are refused', async () => {
  const s = await student();
  for (const courseId of [String(closedCourse), String(hiddenCourse), '999999', '', 'abc', '1 or 1=1']) {
    const r = await ask(s, { courseId });
    assert.ok(!r.ok && r.errors.courseId, courseId);
  }
  const long = await ask(s, { note: 'ن'.repeat(301) });
  assert.ok(!long.ok && long.errors.note);
  assert.ok((await ask(s, { note: 'ن'.repeat(300) })).ok, '300 characters fit (Arabic counted as characters)');
});

test('a student id with no student behind it stores nothing', async () => {
  const r = await requestCourse(db, 987654, { courseId: String(courses[1]), note: '', guardianConsent: true });
  assert.ok(!r.ok && r.errors.form);
  assert.equal(await count('select count(*) as n from registrations where student_id = 987654'), 0);
});

test('the admin sees the new request once, marked as an existing student, with the note and the agreement', async () => {
  const s = await minorStudent();
  const r = await ask(s, { courseId: String(courses[5]), note: 'بعد المدرسة', guardianConsent: true });
  assert.ok(r.ok);
  const pending = await listRequests(db, 'pending');
  const rows = pending.filter((p) => p.id === r.registrationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].existingStudent, true);
  assert.equal(pending.filter((p) => p.studentName === rows[0].studentName).length, 2, 'the first request and this one, one student');
  const first = pending.find((p) => p.studentName === rows[0].studentName && p.id !== r.registrationId);
  assert.equal(first?.existingStudent, false, 'the registration-form request is not marked');

  const detail = await getRequest(db, r.registrationId);
  assert.equal(detail?.existingStudent, true);
  assert.equal(detail?.studentNote, 'بعد المدرسة');
  assert.ok(detail?.requestConsentAt instanceof Date);
  assert.equal(detail?.guardianName, 'جاسم محمد علي', 'the admin sees the guardian on file, as before');
  assert.equal((await getRequest(db, first!.id))?.requestConsentAt, null);
  const counts = await countRequests(db);
  assert.equal(counts.pending + counts.accepted + counts.rejected, await count('select count(*) as n from registrations'));
});

test('maskName keeps one letter per word', () => {
  assert.equal(maskName('  علي   حسن '), 'ع… ح…');
  assert.equal(maskName('جاسم'), 'ج…');
});
