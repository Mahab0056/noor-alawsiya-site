// Schema tests on an in-memory PGlite database. Invented data only.
// Run: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resetDbForTests, type Db } from '@/lib/db';

let db: Db;

before(async () => {
  db = await resetDbForTests();
});
after(async () => {
  await db.close();
});

const rejects = (p: Promise<unknown>, pattern: RegExp) => assert.rejects(p, (e: Error) => pattern.test(e.message), `expected an error matching ${pattern}`);

async function student(name: string, birthYear: number, phone: string, guardian = false) {
  const [row] = await db.query<{ id: string }>(
    `insert into students (full_name, birth_year, phone, password_hash, guardian_name, guardian_phone, guardian_consent_at)
     values ($1, $2, $3, 'x', $4, $5, $6) returning id`,
    [name, birthYear, phone, guardian ? 'ولي أمر تجريبي' : null, guardian ? phone : null, guardian ? new Date() : null]
  );
  return Number(row.id);
}

async function course(name = 'دورة تجريبية') {
  const [row] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher) values ($1, 'tajweed', 'أستاذ تجريبي') returning id`, [name]);
  return Number(row.id);
}

test('migrations apply cleanly and are recorded', async () => {
  const rows = await db.query<{ name: string }>('select name from schema_migrations order by name');
  assert.deepEqual(rows.map((r) => r.name), ['0001_init.sql', '0002_auth.sql', '0003_hardening.sql', '0004_admin_email_code.sql', '0005_owner_admin.sql']);
});

test('a minor cannot be stored without guardian name, phone and consent', async () => {
  const year = new Date().getFullYear();
  await rejects(student('طالب قاصر', year - 15, '07700000001'), /minors_need_guardian/);
  await student('طالب قاصر', year - 15, '07700000001', true);
  await student('طالب بالغ', year - 25, '07700000002');
});

test('siblings can share a guardian phone, but the same name on one phone is rejected', async () => {
  const year = new Date().getFullYear();
  await student('أخ أول', year - 12, '07700000003', true);
  await student('أخ ثانٍ', year - 14, '07700000003', true);
  await rejects(student('أخ أول', year - 12, '07700000003', true), /unique|duplicate/i);
});

test('enrollment follows the registration status', async () => {
  const s = await student('طالب الالتحاق', 1995, '07700000004');
  const c = await course();
  const [reg] = await db.query<{ id: string }>('insert into registrations (student_id, course_id) values ($1, $2) returning id', [s, c]);
  const enrolled = async () => (await db.query('select 1 from enrollments where student_id = $1 and course_id = $2', [s, c])).length;
  assert.equal(await enrolled(), 0, 'pending is not enrolled');
  await db.query(`update registrations set status = 'accepted', reviewed_at = now() where id = $1`, [reg.id]);
  assert.equal(await enrolled(), 1, 'accepted is enrolled');
  await db.query(`update registrations set status = 'rejected' where id = $1`, [reg.id]);
  assert.equal(await enrolled(), 0, 'a later rejection revokes access');
  await rejects(db.query('insert into registrations (student_id, course_id) values ($1, $2)', [s, c]), /unique|duplicate/i);
});

test('an exam question must belong to the exam course, and answers to the exam', async () => {
  const c1 = await course('دورة أ');
  const c2 = await course('دورة ب');
  const [q1] = await db.query<{ id: string }>(`insert into questions (course_id, body, kind) values ($1, 'سؤال', 'yes_no') returning id`, [c1]);
  const [q2] = await db.query<{ id: string }>(`insert into questions (course_id, body, kind) values ($1, 'سؤال', 'yes_no') returning id`, [c2]);
  const [exam] = await db.query<{ id: string }>(`insert into exams (course_id, title, duration_minutes) values ($1, 'امتحان', 15) returning id`, [c1]);
  await db.query('insert into exam_questions (exam_id, question_id, course_id, position) values ($1, $2, $3, 1)', [exam.id, q1.id, c1]);
  await rejects(db.query('insert into exam_questions (exam_id, question_id, course_id, position) values ($1, $2, $3, 2)', [exam.id, q2.id, c1]), /foreign key/i);

  const s = await student('طالب الامتحان', 1990, '07700000005');
  const open = `insert into attempts (exam_id, student_id, attempt_no, expires_at) values ($1, $2, $3, now() + interval '15 minutes') returning id`;
  const [a1] = await db.query<{ id: string }>(open, [exam.id, s, 1]);
  await rejects(db.query(open, [exam.id, s, 2]), /unique|duplicate/i); // one open attempt at a time
  await db.query('insert into attempt_answers (attempt_id, exam_id, question_id, answer) values ($1, $2, $3, $4)', [a1.id, exam.id, q1.id, JSON.stringify(true)]);
  await rejects(db.query('insert into attempt_answers (attempt_id, exam_id, question_id, answer) values ($1, $2, $3, $4)', [a1.id, exam.id, q2.id, JSON.stringify(true)]), /foreign key/i);
});

test('deleting a student removes everything about them', async () => {
  const s = await student('طالب للحذف', 1992, '07700000006');
  const c = await course('دورة الحذف');
  await db.query('insert into registrations (student_id, course_id) values ($1, $2)', [s, c]);
  await db.query(`insert into sessions (token_hash, kind, student_id, expires_at) values ('h', 'student', $1, now() + interval '1 day')`, [s]);
  await db.query('delete from students where id = $1', [s]);
  for (const table of ['registrations', 'sessions']) {
    assert.equal((await db.query(`select 1 from ${table} where student_id = $1`, [s])).length, 0, table);
  }
});

test('a session row is either a student session or an admin session', async () => {
  await rejects(db.query(`insert into sessions (token_hash, kind, expires_at) values ('h2', 'admin', now() + interval '1 day')`), /check/i);
});
