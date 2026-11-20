// «إبلاغ عبر واتساب»: number normalising, the prepared message, and the audit line. Invented data only; nothing is sent.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { lastNotifiedAt, recordNotified, reviewRequest } from '@/lib/admin';
import { resetDbForTests, type Db } from '@/lib/db';
import { register } from '@/lib/registration';
import { decisionMessage, notifyRecipient, whatsappLink, whatsappNumber } from '@/lib/whatsapp';

const YEAR = new Date().getFullYear();

test('Iraqi numbers become 9647XXXXXXXXX for wa.me', () => {
  assert.equal(whatsappNumber('07701234567'), '9647701234567');
  assert.equal(whatsappNumber('0770 123 4567'), '9647701234567');
  assert.equal(whatsappNumber('+964 770 123 4567'), '9647701234567');
  assert.equal(whatsappNumber('00964 7701234567'), '9647701234567');
  assert.equal(whatsappNumber('9647801234567'), '9647801234567');
  assert.equal(whatsappNumber('٠٧٥٠١٢٣٤٥٦٧'), '9647501234567');
  assert.equal(whatsappNumber('0770-123-4567'), '9647701234567');
});

test('numbers that are not Iraqi mobiles give no WhatsApp number', () => {
  for (const bad of ['', '   ', '12345', '0770123456', '077012345678', '01 234 5678', '07201234567', '+44 7700 900123', 'abc', null, undefined]) {
    assert.equal(whatsappNumber(bad), null, String(bad));
  }
});

test('a minor’s guardian gets the message; an adult gets it on their own phone', () => {
  const now = new Date(Date.UTC(YEAR, 5, 1));
  assert.deepEqual(notifyRecipient({ birthYear: YEAR - 12, phone: '07701111111', guardianPhone: '07802222222' }, now), { to: 'guardian', number: '9647802222222' });
  assert.deepEqual(notifyRecipient({ birthYear: YEAR - 30, phone: '07701111111', guardianPhone: null }, now), { to: 'student', number: '9647701111111' });
  // Registered as a minor years ago, an adult now: the student is told directly.
  assert.deepEqual(notifyRecipient({ birthYear: YEAR - 25, phone: '07701111111', guardianPhone: '07802222222' }, now), { to: 'student', number: '9647701111111' });
  // A minor without a guardian phone cannot exist (DB check minors_need_guardian); fall back to the student's own phone.
  assert.deepEqual(notifyRecipient({ birthYear: YEAR - 12, phone: '07701111111', guardianPhone: null }, now), { to: 'student', number: '9647701111111' });
});

test('the message says the course and the result, links /account, and holds nothing else', () => {
  const ok = decisionMessage('accepted', 'دورة تجريبية', 'https://noor-alawsiya.com');
  const no = decisionMessage('rejected', 'دورة تجريبية', 'https://noor-alawsiya.com');
  for (const m of [ok, no]) {
    assert.match(m, /^السلام عليكم/);
    assert.match(m, /«دورة تجريبية»/);
    assert.match(m, /https:\/\/noor-alawsiya\.com\/account$/);
    assert.ok(m.length < 400, 'short');
    assert.doesNotMatch(m, /\d{6,}/, 'no phone number or code');
    assert.doesNotMatch(m, /كلمة (ال)?(سر|مرور)/, 'no password');
  }
  assert.match(ok, /بقبول طلب التسجيل/);
  assert.doesNotMatch(ok, /لم يُقبل/);
  assert.match(no, /لم يُقبل طلب التسجيل/);
  assert.doesNotMatch(no, /بقبول/);
});

test('the wa.me link carries the number and the message, fully encoded', () => {
  const text = decisionMessage('accepted', 'دورة السيدة نرجس (ع) & #2?', 'https://noor-alawsiya.com');
  const url = new URL(whatsappLink('9647701234567', text));
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/9647701234567');
  assert.deepEqual([...url.searchParams.keys()], ['text']);
  assert.equal(url.searchParams.get('text'), text);
  assert.equal(url.hash, '');
});

// ---------------------------------------------------------------- audit line, on PGlite

let db: Db;
let adminId: number;
let requestId: number;

before(async () => {
  db = await resetDbForTests();
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة تجريبية', 'tajweed', 'أستاذ تجريبي', true) returning id`);
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'notify@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  const r = await register(db, {
    fullName: 'طالب تجريبي', birthYear: String(YEAR - 13), phone: '0770 123 4567', password: 'password-1',
    guardianName: 'ولي أمر تجريبي', guardianPhone: '0780 765 4321', guardianConsent: true, courseId: String(c.id), answers: {},
  });
  assert.ok(r.ok, JSON.stringify(r));
  const [row] = await db.query<{ id: string }>('select id from registrations where student_id = $1', [r.studentId]);
  requestId = Number(row.id);
});
after(async () => {
  await db.close();
});

const notifyRows = () => db.query<{ admin_id: string; target: string; detail: unknown }>(`select admin_id, target, detail from audit_log where action = 'registration.notified' order by id`);

test('a pending request cannot be marked notified', async () => {
  assert.equal(await recordNotified(db, adminId, requestId), false);
  assert.equal((await notifyRows()).length, 0);
  assert.equal(await lastNotifiedAt(db, requestId), null);
});

test('an unknown request is ignored', async () => {
  assert.equal(await recordNotified(db, adminId, 999999), false);
  assert.equal((await notifyRows()).length, 0);
});

test('«notified» is logged by request id and decision only, never a phone, name or message', async () => {
  await reviewRequest(db, adminId, requestId, 'accepted', 'ملاحظة تجريبية');
  assert.equal(await recordNotified(db, adminId, requestId), true);
  const rows = await notifyRows();
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].admin_id), adminId);
  assert.equal(rows[0].target, `registration:${requestId}`);
  assert.deepEqual(rows[0].detail, { decision: 'accepted' });
  const whole = JSON.stringify(await db.query('select * from audit_log'));
  for (const secret of ['07701234567', '9647701234567', '07807654321', '9647807654321', 'طالب تجريبي', 'ولي أمر تجريبي', 'ملاحظة تجريبية', 'wa.me']) {
    assert.ok(!whole.includes(secret), `audit log holds ${secret}`);
  }
  assert.ok(await lastNotifiedAt(db, requestId));
});

test('changing the decision clears «notified» until the new decision is sent; saving a note does not', async () => {
  await reviewRequest(db, adminId, requestId, 'accepted', 'ملاحظة أخرى');
  assert.ok(await lastNotifiedAt(db, requestId), 'same decision, only the note changed');
  await reviewRequest(db, adminId, requestId, 'rejected', '');
  assert.equal(await lastNotifiedAt(db, requestId), null);
  assert.equal(await recordNotified(db, adminId, requestId), true);
  assert.ok(await lastNotifiedAt(db, requestId));
  assert.deepEqual((await notifyRows()).map((r) => r.detail), [{ decision: 'accepted' }, { decision: 'rejected' }]);
});
