// Review of PR #4 (awsiya-review-audit-pr4, 21/11/2026): the temporary password must work for a student who is locked
// out by failed tries, and must say which phone to sign in with (a minor's goes to the guardian). Invented data only.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAdmin, loginStudent } from '@/lib/accounts';
import { resetDbForTests, type Db } from '@/lib/db';
import { listQuestions, register, type RegistrationInput } from '@/lib/registration';
import { resetStudentPassword, tempPasswordMessage } from '@/lib/student-reset';

let db: Db;
let adminId: number;
let courseId: number;
const YEAR = new Date().getFullYear();

before(async () => {
  db = await resetDbForTests();
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة تجريبية', 'tajweed', 'أستاذ تجريبي', true) returning id`);
  courseId = Number(c.id);
  adminId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'review-pr4@example.test', password: 'a-long-test-password', role: 'staff' })).adminId;
});
after(async () => {
  await db.close();
});

async function student(over: Partial<RegistrationInput>) {
  const answers: Record<string, string> = {};
  for (const q of await listQuestions(db)) if (q.required && !q.showIf) answers[String(q.id)] = q.kind === 'yes_no' ? 'لا' : q.kind === 'text' ? 'جواب' : q.options[0];
  const r = await register(db, {
    fullName: 'طالب تجريبي', birthYear: String(YEAR - 30), phone: '07702223344', password: 'old-password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courseId), answers, ...over,
  });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return r;
}

test('a student locked out by failed tries can sign in with the temporary password at once', async () => {
  const r = await student({});
  for (let i = 0; i < 5; i++) assert.equal((await loginStudent(db, '07702223344', `wrong-${i}-password`, '10.0.0.9')).ok, false);
  const locked = await loginStudent(db, '07702223344', 'old-password-1', '10.0.0.9');
  assert.deepEqual(locked, { ok: false, reason: 'throttled' }, 'five failures lock the phone');
  const reset = await resetStudentPassword(db, adminId, r.registrationId);
  assert.ok(reset);
  assert.deepEqual(await loginStudent(db, '07702223344', reset.password, '10.0.0.9'), { ok: true, studentId: r.studentId });
  // only that phone's failures go: another phone's lock stays
  for (let i = 0; i < 5; i++) await loginStudent(db, '07709998877', `wrong-${i}-password`, '10.0.0.10');
  const other = await student({ fullName: 'طالب تجريبي آخر', phone: '07702223355' });
  await resetStudentPassword(db, adminId, other.registrationId);
  assert.deepEqual(await loginStudent(db, '07709998877', 'anything-at-all', '10.0.0.10'), { ok: false, reason: 'throttled' });
});

test("a minor's message goes to the guardian and names the student's phone by its last 4 digits", async () => {
  const r = await student({ fullName: 'طالب تجريبي صغير', birthYear: String(YEAR - 12), phone: '07803334455', guardianName: 'ولي أمر تجريبي', guardianPhone: '07503334466', guardianConsent: true });
  const reset = await resetStudentPassword(db, adminId, r.registrationId);
  assert.equal(reset?.to, 'guardian');
  assert.equal(reset?.number, '9647503334466');
  assert.equal(reset?.phoneEnd, '4455', "the student's phone, not the guardian's");
  const msg = tempPasswordMessage(reset.password, 'https://noor-alawsiya.com', reset.phoneEnd);
  assert.ok(msg.includes('برقم هاتف الطالب المنتهي بـ 4455'), msg);
  assert.ok(!msg.includes('07803334455') && !msg.includes('7803334455'), 'not the full phone');
  assert.ok(tempPasswordMessage('abcd234567').includes('برقم هاتف الطالب المسجّل في الطلب'));
});
