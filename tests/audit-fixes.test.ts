// Fixes from the 21/11/2026 audit (audit-awsiya-2011): student temporary password, truthful «التسجيل مفتوح», CSP,
// Arabic 404. In-memory PGlite (or TEST_DATABASE_URL), invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createAdmin, loginStudent } from '@/lib/accounts';
import { createSession, readSession } from '@/lib/auth';
import { contentSecurityPolicy } from '@/lib/csp';
import { resetDbForTests, type Db } from '@/lib/db';
import { registrationCopy } from '@/lib/open-copy';
import { listQuestions, register, type RegistrationInput } from '@/lib/registration';
import { resetStudentPassword, TEMP_ALPHABET, TEMP_LENGTH, tempPassword, tempPasswordMessage } from '@/lib/student-reset';

let db: Db;
let adminId: number;
let courseId: number;
const YEAR = new Date().getFullYear();

before(async () => {
  db = await resetDbForTests();
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة تجريبية', 'tajweed', 'أستاذ تجريبي', true) returning id`);
  courseId = Number(c.id);
  adminId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'audit-fixes@example.test', password: 'a-long-test-password', role: 'staff' })).adminId;
});
after(async () => {
  await db.close();
});

async function student(over: Partial<RegistrationInput>) {
  const answers: Record<string, string> = {};
  for (const q of await listQuestions(db)) if (q.required && !q.showIf) answers[String(q.id)] = q.kind === 'yes_no' ? 'لا' : q.kind === 'text' ? 'جواب' : q.options[0];
  const r = await register(db, {
    fullName: 'طالب تجريبي أول', birthYear: String(YEAR - 30), phone: '07701112233', password: 'old-password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courseId), answers, ...over,
  });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return r;
}

test('a temporary password replaces the old one, ends every session, and is audited by id only', async () => {
  const r = await student({});
  const { token } = await createSession(db, 'student', r.studentId);
  const reset = await resetStudentPassword(db, adminId, r.registrationId);
  assert.ok(reset);
  assert.equal(reset.password.length, TEMP_LENGTH);
  assert.equal(reset.to, 'student');
  assert.equal(reset.number, '9647701112233');
  assert.equal(await readSession(db, token), null, 'the old session ended');
  const oldTry = await loginStudent(db, '07701112233', 'old-password-1', '10.0.0.1');
  assert.equal(oldTry.ok, false);
  const newTry = await loginStudent(db, '07701112233', reset.password, '10.0.0.2');
  assert.deepEqual(newTry, { ok: true, studentId: r.studentId });
  const [log] = await db.query<{ admin_id: string; action: string; target: string; detail: unknown }>(`select admin_id, action, target, detail from audit_log where action = 'student.password_reset'`);
  assert.deepEqual({ ...log, admin_id: Number(log.admin_id) }, { admin_id: adminId, action: 'student.password_reset', target: `student:${r.studentId}`, detail: null });
  const [{ hash }] = await db.query<{ hash: string }>('select password_hash as hash from students where id = $1', [r.studentId]);
  assert.ok(hash.startsWith('$argon2id$') && !hash.includes(reset.password), 'only a hash is stored');
});

test("a minor's temporary password goes to the guardian's number; an unknown request changes nothing", async () => {
  const r = await student({ fullName: 'طالب تجريبي صغير', birthYear: String(YEAR - 12), phone: '07801112233', guardianName: 'ولي أمر تجريبي', guardianPhone: '07501112233', guardianConsent: true });
  const reset = await resetStudentPassword(db, adminId, r.registrationId);
  assert.equal(reset?.to, 'guardian');
  assert.equal(reset?.number, '9647501112233');
  assert.equal(await resetStudentPassword(db, adminId, 999_999), null);
});

test('temporary passwords use the unambiguous alphabet and do not repeat', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const p = tempPassword();
    assert.match(p, new RegExp(`^[${TEMP_ALPHABET}]{${TEMP_LENGTH}}$`));
    seen.add(p);
  }
  assert.equal(seen.size, 300);
  assert.doesNotMatch(TEMP_ALPHABET, /[01ilo]/);
  const msg = tempPasswordMessage('abcd234567', 'https://noor-alawsiya.com');
  assert.ok(msg.includes('abcd234567') && msg.includes('https://noor-alawsiya.com/login'));
});

test('the strip and the home page only say «التسجيل مفتوح» when a course is open', () => {
  assert.equal(registrationCopy(2).strip, 'التسجيل مفتوح للدورات الحالية');
  assert.match(registrationCopy(1).title, /مفتوح/);
  for (const closed of [registrationCopy(0), registrationCopy(null)]) {
    assert.doesNotMatch(`${closed.strip} ${closed.title} ${closed.text}`, /التسجيل مفتوح/);
  }
  assert.match(registrationCopy(0).strip, /مغلق/);
  // The fixed sentence is gone from the header and the home page.
  for (const file of ['components/SiteChrome.tsx', 'app/page.tsx']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /التسجيل مفتوح/, file);
  }
});

test('CSP: nothing from other origins, no framing; eval only for next dev', () => {
  const prod = contentSecurityPolicy(false);
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) assert.ok(prod.includes(d), d);
  assert.doesNotMatch(prod, /unsafe-eval|ws:|https?:/);
  assert.match(contentSecurityPolicy(true), /'unsafe-eval'/);
  const config = readFileSync('next.config.ts', 'utf8');
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /poweredByHeader: false/);
});

test('404 and error pages are Arabic', () => {
  assert.match(readFileSync('app/not-found.tsx', 'utf8'), /الصفحة غير موجودة/);
  assert.match(readFileSync('app/error.tsx', 'utf8'), /تعذّر عرض الصفحة/);
  const global = readFileSync('app/global-error.tsx', 'utf8');
  assert.match(global, /lang="ar" dir="rtl"/);
});

test('getDb: a failed first open is forgotten, so the next call tries again', async () => {
  const saved = { url: process.env.DATABASE_URL, real: process.env.TEST_DATABASE_URL };
  const holder = globalThis as unknown as { __noorDb?: Promise<Db> };
  const before = holder.__noorDb;
  holder.__noorDb = undefined;
  process.env.DATABASE_URL = 'postgres://nobody:none@127.0.0.1:1/none'; // nothing listens on port 1
  try {
    const { getDb } = await import('@/lib/db');
    await assert.rejects(getDb());
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(holder.__noorDb, undefined, 'the rejected promise is not kept');
    await assert.rejects(getDb()); // a new attempt, not the cached failure
  } finally {
    holder.__noorDb = before;
    if (saved.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.url;
  }
});
