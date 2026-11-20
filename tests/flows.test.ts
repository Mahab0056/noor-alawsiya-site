// Registration, login and admin review on an in-memory PGlite database. Invented data only.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAdmin, loginAdmin, loginStudent } from '@/lib/accounts';
import { addQuestion, countRequests, getRequest, listRequests, moveQuestion, reviewRequest, setQuestionActive, validateQuestion } from '@/lib/admin';
import { allowRegistration, createSession, destroySession, normalizePhone, readSession, seal, totpAt, unseal, verifyTotp } from '@/lib/auth';
import { isMinorIn, visibleQuestions } from '@/lib/form-rules';
import { resetDbForTests, type Db } from '@/lib/db';
import { listQuestions, listStudentRegistrations, NO, register, validateStudent, YES, type RegistrationInput } from '@/lib/registration';

// These tests cover the authenticator-app path, kept behind ADMIN_TOTP=1 (lib/flags.ts). The default e-mail-code
// path is in tests/email-codes.test.ts. Read at call time, so setting it here is enough.
process.env.ADMIN_TOTP = '1';

let db: Db;
let courseId: number;
let adminId: number;
let totpSecret: string;
let q: { level: number; before: number; which: number; days: number };

const YEAR = new Date().getFullYear();
const IP = '127.0.0.1';

before(async () => {
  db = await resetDbForTests();
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة تجريبية', 'tajweed', 'أستاذ تجريبي', true) returning id`);
  courseId = Number(c.id);
  await db.query(`insert into courses (name, kind, teacher, published, status) values ('دورة منتهية', 'tajweed', 'أستاذ تجريبي', true, 'done')`);
  const created = await createAdmin(db, { name: 'مدير تجريبي', email: 'Admin@Example.test', password: 'a-long-test-password', role: 'owner' });
  adminId = created.adminId;
  totpSecret = created.totpSecret;
  q = {
    level: await addQuestion(db, adminId, { label: 'ما مستواك الحالي في التلاوة؟', kind: 'single', options: ['مبتدئ', 'أقرأ بطلاقة', 'أتقن التجويد'], required: true, showIf: null }),
    before: await addQuestion(db, adminId, { label: 'هل درست في دورة من قبل؟', kind: 'yes_no', options: [], required: true, showIf: null }),
    which: 0,
    days: await addQuestion(db, adminId, { label: 'الأيام المناسبة', kind: 'multi', options: ['السبت', 'الأحد', 'الثلاثاء'], required: false, showIf: null }),
  };
  q.which = await addQuestion(db, adminId, { label: 'اسم الدورة السابقة', kind: 'text', options: [], required: true, showIf: { question_id: q.before, equals: YES } });
});
after(async () => {
  await db.close();
});

const input = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
  fullName: 'طالب تجريبي', birthYear: String(YEAR - 25), phone: '0770 123 4567', password: 'password-1',
  guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courseId),
  answers: { [q.level]: 'مبتدئ', [q.before]: NO },
  ...over,
});

test('phone numbers are normalised to 07XXXXXXXXX', () => {
  assert.equal(normalizePhone('+964 770 123 4567'), '07701234567');
  assert.equal(normalizePhone('٠٧٧٠١٢٣٤٥٦٧'), '07701234567');
  assert.equal(normalizePhone('12345'), null);
});

test('an adult registers; the request is pending and visible to the student', async () => {
  const r = await register(db, input());
  assert.ok(r.ok);
  const mine = await listStudentRegistrations(db, r.studentId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'pending');
  const [s] = await db.query<{ password_hash: string; phone: string }>('select password_hash, phone from students where id = $1', [r.studentId]);
  assert.match(s.password_hash, /^\$argon2id\$/, 'password is stored as an argon2id hash');
  assert.equal(s.phone, '07701234567');
});

test('validation reports each problem and stores nothing', async () => {
  const before = (await db.query('select 1 from students')).length;
  const r = await register(db, input({ fullName: 'علي', birthYear: '12', phone: '123', password: 'short', courseId: '999', answers: {} }));
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), ['birthYear', 'courseId', 'fullName', 'password', 'phone', `q${q.before}`, `q${q.level}`].sort());
  assert.equal((await db.query('select 1 from students')).length, before);
});

test('a closed course cannot be registered for', async () => {
  const [done] = await db.query<{ id: string }>(`select id from courses where status = 'done'`);
  const r = await register(db, input({ fullName: 'طالب آخر', phone: '07701234568', courseId: String(done.id) }));
  assert.ok(!r.ok && r.errors.courseId);
});

test('the same name and phone cannot register twice', async () => {
  const r = await register(db, input());
  assert.ok(!r.ok && r.errors.phone);
});

test('a minor needs a guardian name, phone and consent', async () => {
  const minor = { fullName: 'طالب قاصر', birthYear: String(YEAR - 14), phone: '07711111111' };
  const bad = await register(db, input(minor));
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['guardianConsent', 'guardianName', 'guardianPhone']);
  const good = await register(db, input({ ...minor, guardianName: 'ولي أمر تجريبي', guardianPhone: '07711111111', guardianConsent: true }));
  assert.ok(good.ok);
  const [s] = await db.query<{ guardian_consent_at: Date | null; consent_version: string | null }>('select guardian_consent_at, consent_version from students where id = $1', [good.studentId]);
  assert.ok(s.guardian_consent_at && s.consent_version);
});

test('a conditional question is required only when shown, and ignored when hidden', async () => {
  const missing = await register(db, input({ fullName: 'طالب الشرط', phone: '07722222222', answers: { [q.level]: 'مبتدئ', [q.before]: YES } }));
  assert.ok(!missing.ok && missing.errors[`q${q.which}`]);
  const hidden = await register(db, input({ fullName: 'طالب الشرط', phone: '07722222222', answers: { [q.level]: 'مبتدئ', [q.before]: NO, [q.which]: 'قيمة لا يجب حفظها', [q.days]: ['السبت', 'الثلاثاء'] } }));
  assert.ok(hidden.ok);
  const stored = await db.query<{ question_id: string }>('select question_id from registration_answers where registration_id = $1', [hidden.registrationId]);
  assert.deepEqual(stored.map((a) => Number(a.question_id)).sort(), [q.level, q.before, q.days].sort());
});

test('answers outside the offered options are rejected', async () => {
  const r = await register(db, input({ fullName: 'طالب الخيارات', phone: '07733333333', answers: { [q.level]: 'خيار مخترع', [q.before]: 'ربما', [q.days]: ['الجمعة'] } }));
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), [`q${q.level}`, `q${q.before}`, `q${q.days}`].sort());
});

test('student login: right password, wrong password, and lock after repeated failures', async () => {
  const ok = await loginStudent(db, '07701234567', 'password-1', IP);
  assert.ok(ok.ok);
  for (let i = 0; i < 5; i++) {
    const r = await loginStudent(db, '07701234567', 'wrong-password', '10.0.0.9');
    assert.deepEqual(r, { ok: false, reason: 'invalid' });
  }
  assert.deepEqual(await loginStudent(db, '07701234567', 'password-1', '10.0.0.9'), { ok: false, reason: 'throttled' });
  assert.deepEqual(await loginStudent(db, '07799999999', 'whatever-password', IP), { ok: false, reason: 'invalid' }, 'unknown phone fails the same way');
  await db.query('delete from login_attempts');
});

test('siblings on one phone with the same password choose their name', async () => {
  for (const name of ['أخ أول', 'أخ ثانٍ']) {
    const r = await register(db, input({ fullName: name, birthYear: String(YEAR - 12), phone: '07744444444', guardianName: 'ولي أمر تجريبي', guardianPhone: '07744444444', guardianConsent: true, password: 'same-password' }));
    assert.ok(r.ok);
  }
  const ask = await loginStudent(db, '07744444444', 'same-password', IP);
  assert.deepEqual(ask, { ok: false, reason: 'choose', names: ['أخ أول', 'أخ ثانٍ'] });
  const picked = await loginStudent(db, '07744444444', 'same-password', IP, 'أخ ثانٍ');
  assert.ok(picked.ok);
});

test('sessions: only the hash is stored, and logout ends the session', async () => {
  const { token } = await createSession(db, 'student', 1);
  const [row] = await db.query<{ token_hash: string }>('select token_hash from sessions');
  assert.notEqual(row.token_hash, token);
  assert.deepEqual((await readSession(db, token))?.kind, 'student');
  assert.equal(await readSession(db, 'not-a-token'), null);
  await destroySession(db, token);
  assert.equal(await readSession(db, token), null);
});

test('TOTP matches the RFC 6238 test vector and tolerates one step of drift', () => {
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(totpAt(rfcSecret, 59_000), '287082');
  const now = Date.now();
  assert.ok(verifyTotp(totpSecret, totpAt(totpSecret, now - 30_000), now));
  assert.ok(!verifyTotp(totpSecret, totpAt(totpSecret, now - 120_000), now));
  assert.equal(unseal(seal(totpSecret)), totpSecret);
});

test('admin login needs email, password and a current code', async () => {
  const code = () => totpAt(totpSecret, Date.now());
  assert.ok((await loginAdmin(db, 'admin@example.test', 'a-long-test-password', code(), IP)).ok, 'email is case-insensitive');
  assert.deepEqual(await loginAdmin(db, 'admin@example.test', 'a-long-test-password', '000000', IP), { ok: false, reason: 'invalid' });
  assert.deepEqual(await loginAdmin(db, 'admin@example.test', 'wrong-password-here', code(), IP), { ok: false, reason: 'invalid' });
  assert.deepEqual(await loginAdmin(db, 'nobody@example.test', 'a-long-test-password', code(), IP), { ok: false, reason: 'invalid' });
  const [stored] = await db.query<{ totp_secret: string }>('select totp_secret from admins');
  assert.notEqual(stored.totp_secret, totpSecret, 'the TOTP secret is encrypted at rest');
  await db.query('delete from login_attempts');
});

test('the admin sees the request with its answers, accepts it, and can reverse it', async () => {
  const pending = await listRequests(db, 'pending');
  const mine = pending.find((r) => r.studentName === 'طالب الشرط');
  assert.ok(mine);
  const detail = await getRequest(db, mine.id);
  assert.deepEqual(detail?.answers.map((a) => a.answer), ['مبتدئ', NO, 'السبت، الثلاثاء']);

  assert.equal(await reviewRequest(db, adminId, mine.id, 'accepted', 'أهلاً بك في الحلقة'), 'saved');
  const enrolled = async () => (await db.query('select 1 from enrollments e join registrations r on r.student_id = e.student_id and r.course_id = e.course_id where r.id = $1', [mine.id])).length;
  assert.equal(await enrolled(), 1);
  assert.equal((await countRequests(db)).accepted, 1);
  assert.equal(await reviewRequest(db, adminId, mine.id, 'rejected', ''), 'saved');
  assert.equal(await enrolled(), 0);
  assert.equal(await reviewRequest(db, adminId, 99999, 'accepted', ''), 'missing');

  const log = await db.query<{ action: string; target: string; detail: unknown }>(`select action, target, detail from audit_log where target = $1 order by id`, [`registration:${mine.id}`]);
  assert.deepEqual(log.map((l) => l.action), ['registration.accepted', 'registration.rejected']);
  assert.ok(!JSON.stringify(log).includes('طالب الشرط'), 'the audit log holds no student names');
});

test('questionnaire builder: validate, reorder and disable', async () => {
  assert.ok(validateQuestion({ label: 'سؤال', kind: 'single', options: ['واحد'], required: false, showIf: null }));
  assert.equal(validateQuestion({ label: 'سؤال صالح', kind: 'text', options: [], required: false, showIf: null }), null);
  const order = async () => (await listQuestions(db)).map((x) => x.id);
  const beforeMove = await order();
  await moveQuestion(db, adminId, beforeMove[1], 'up');
  const afterMove = await order();
  assert.deepEqual(afterMove.slice(0, 2), [beforeMove[1], beforeMove[0]]);
  await setQuestionActive(db, adminId, q.days, false);
  assert.ok(!(await order()).includes(q.days));
  assert.ok((await listQuestions(db, { includeInactive: true })).some((x) => x.id === q.days));
});

// ---------------------------------------------------------------- added after the independent reviews

test('a successful login does not reset the failure counter for that phone', async () => {
  await db.query('delete from login_attempts');
  for (const name of ['ضحية تجريبية', 'مهاجم تجريبي']) {
    const r = await register(db, input({ fullName: name, phone: '07755555555', password: name === 'ضحية تجريبية' ? 'victim-password' : 'attacker-password' }));
    assert.ok(r.ok);
  }
  for (let i = 0; i < 4; i++) assert.deepEqual(await loginStudent(db, '07755555555', `guess-${i}`, '10.0.0.9'), { ok: false, reason: 'invalid' });
  assert.ok((await loginStudent(db, '07755555555', 'attacker-password', '10.0.0.9')).ok);
  assert.deepEqual(await loginStudent(db, '07755555555', 'guess-4', '10.0.0.9'), { ok: false, reason: 'invalid' });
  assert.deepEqual(await loginStudent(db, '07755555555', 'victim-password', '10.0.0.9'), { ok: false, reason: 'throttled' });
  await db.query('delete from login_attempts');
});

test('a TOTP code works once, and odd input is refused without an error', async () => {
  await db.query('update admins set totp_last_step = null');
  const code = totpAt(totpSecret, Date.now());
  assert.ok((await loginAdmin(db, 'admin@example.test', 'a-long-test-password', code, IP)).ok);
  assert.deepEqual(await loginAdmin(db, 'admin@example.test', 'a-long-test-password', code, IP), { ok: false, reason: 'invalid' });
  for (const odd of ['١٢٣٤٥٦', 'abcdef', '', '12345', '1234567']) assert.equal(verifyTotp(totpSecret, odd), false);
  const arabic = totpAt(totpSecret, Date.now()).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  assert.ok(verifyTotp(totpSecret, arabic), 'Arabic-Indic digits are accepted');
  await db.query('delete from login_attempts');
});

test('registration is limited per address, separately from logins', async () => {
  for (let i = 0; i < 8; i++) assert.ok(await allowRegistration(db, '10.0.0.7'));
  assert.equal(await allowRegistration(db, '10.0.0.7'), false);
  assert.ok(await allowRegistration(db, '10.0.0.8'));
  assert.ok((await loginStudent(db, '07755555555', 'victim-password', '10.0.0.7')).ok, 'logins from that address still work');
});

test('phone and birth-year rules are the same for Arabic-Indic digits and at the age boundary', () => {
  assert.equal(normalizePhone('٠٧٧٠١٢٣٤٥٦٧'), '07701234567');
  assert.equal(normalizePhone('+964 770 123 4567'), '07701234567');
  assert.equal(isMinorIn(2008, 2026), true);
  assert.equal(isMinorIn(2007, 2026), false);
  const at = new Date(2026, 5, 1);
  assert.equal(validateStudent(input({ birthYear: '٢٠٠٨', guardianName: '', guardianPhone: '' }), at).errors.guardianName, 'اكتب اسم ولي الأمر.');
  assert.equal(validateStudent(input({ birthYear: '2007' }), at).errors.guardianName, undefined);
  assert.equal(validateStudent(input({ birthYear: '1900' }), at).errors.birthYear, 'سنة الميلاد غير صحيحة.');
  assert.equal(validateStudent(input({ birthYear: '2024' }), at).errors.birthYear, 'سنة الميلاد غير صحيحة.');
});

test('a question that depends on a hidden question stays hidden', async () => {
  const all = await listQuestions(db);
  const parent = all.find((x) => x.id === q.before)!;
  const child = all.find((x) => x.id === q.which)!;
  const grandchild = { ...child, id: 9001, showIf: { question_id: child.id, equals: 'نص' } };
  const shown = visibleQuestions([parent, child, grandchild], { [parent.id]: NO, [child.id]: 'نص' });
  assert.deepEqual(shown.map((x) => x.id), [parent.id]);
});

test('moving a question works when positions are tied, and does nothing at the ends', async () => {
  await db.query('update form_questions set position = 1');
  const before = (await listQuestions(db, { includeInactive: true })).map((x) => x.id);
  await moveQuestion(db, adminId, before[0], 'down');
  const after1 = (await listQuestions(db, { includeInactive: true })).map((x) => x.id);
  assert.deepEqual(after1.slice(0, 2), [before[1], before[0]]);
  await moveQuestion(db, adminId, after1[0], 'up');
  await moveQuestion(db, adminId, after1.at(-1)!, 'down');
  assert.deepEqual((await listQuestions(db, { includeInactive: true })).map((x) => x.id), after1);
  const positions = (await db.query<{ position: number }>('select position from form_questions order by position')).map((r) => r.position);
  assert.deepEqual(positions, positions.map((_, i) => i + 1));
});
