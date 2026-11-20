// «الدورات» in the admin panel: opening and closing registration per course, adding a course. Invented data only.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { addCourse, listCoursesForAdmin, setCourseAccepting, validateCourse } from '@/lib/courses';
import { resetDbForTests, type Db } from '@/lib/db';
import { listOpenCourses, register } from '@/lib/registration';

const YEAR = new Date().getFullYear();
let db: Db;
let adminId: number;
let running: number;
let finished: number;

before(async () => {
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'courses@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  // As the seed now writes them: the record says 'open' (still running) but registration is closed.
  [{ id: running }] = (await db.query<{ id: string }>(`insert into courses (name, teacher, status, published) values ('دورة جارية', 'أستاذ تجريبي', 'open', false) returning id`)).map((r) => ({ id: Number(r.id) }));
  [{ id: finished }] = (await db.query<{ id: string }>(`insert into courses (name, teacher, status, published) values ('دورة منتهية', 'أستاذ تجريبي', 'done', false) returning id`)).map((r) => ({ id: Number(r.id) }));
});
after(async () => {
  await db.close();
});

const auditRows = () => db.query<{ action: string; target: string; detail: unknown }>(`select action, target, detail from audit_log where action like 'course.%' order by id`);

test('a seeded course is not in the registration form until a super admin opens it', async () => {
  assert.deepEqual(await listOpenCourses(db), []);
  const list = await listCoursesForAdmin(db);
  assert.equal(list.length, 2);
  assert.ok(list.every((c) => !c.accepting));
});

test('opening puts the course in the form; closing takes it out and keeps the requests', async () => {
  assert.equal(await setCourseAccepting(db, adminId, running, true), 'saved');
  assert.deepEqual((await listOpenCourses(db)).map((c) => c.id), [running]);

  const r = await register(db, {
    fullName: 'طالب تجريبي', birthYear: String(YEAR - 30), phone: '07701231234', password: 'password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(running), answers: {},
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await listCoursesForAdmin(db)).find((c) => c.id === running)?.pending, 1);

  assert.equal(await setCourseAccepting(db, adminId, running, false), 'saved');
  assert.deepEqual(await listOpenCourses(db), []);
  const [{ n }] = await db.query<{ n: string }>('select count(*) as n from registrations where course_id = $1', [running]);
  assert.equal(Number(n), 1);
  // A closed course refuses new registrations (the form's course list is the only way in).
  const late = await register(db, {
    fullName: 'طالب متأخر', birthYear: String(YEAR - 30), phone: '07701231235', password: 'password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(running), answers: {},
  });
  assert.equal(late.ok, false);
});

test('a finished course cannot be opened, and an unknown id is reported', async () => {
  assert.equal(await setCourseAccepting(db, adminId, finished, true), 'done');
  assert.equal(await setCourseAccepting(db, adminId, 999999, true), 'missing');
  assert.deepEqual(await listOpenCourses(db), []);
});

test('a new course is added closed or open, and validated', async () => {
  const bad = validateCourse({ name: ' ا ', teacher: '', place: 'x'.repeat(161), startedOn: '', open: false });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['name', 'place', 'teacher']);

  const good = validateCourse({ name: '  دورة   الشتاء ', teacher: 'الأستاذ التجريبي', place: '', startedOn: '١ كانون الأول ٢٠٢٦', open: true });
  assert.ok(good.ok);
  if (!good.ok) return;
  assert.equal(good.value.name, 'دورة الشتاء');
  const id = await addCourse(db, adminId, good.value);
  assert.deepEqual((await listOpenCourses(db)).map((c) => c.id), [id]);
  const row = (await listCoursesForAdmin(db)).find((c) => c.id === id);
  assert.equal(row?.place, null);
  assert.equal(row?.startedOn, '١ كانون الأول ٢٠٢٦');
});

test('every change is in the audit log by course id only', async () => {
  const rows = await auditRows();
  assert.deepEqual(rows.map((r) => r.action), ['course.opened', 'course.closed', 'course.added']);
  assert.equal(rows[0].target, `course:${running}`);
  const whole = JSON.stringify(rows);
  for (const s of ['دورة جارية', 'دورة الشتاء', 'طالب تجريبي', '07701231234']) assert.ok(!whole.includes(s), `audit log holds ${s}`);
});
