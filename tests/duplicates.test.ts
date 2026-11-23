// «يمكن مكرر» (awsiya-dev-duplicate-requests-2221): likely copies of a request are pointed out, «اعتبره مكرر» closes a
// copy without counting as a rejection or sending anything, and a family sending the form again is told «طلبك وصلنا
// قبل». Behind DUPLICATE_HINTS, default off. Invented data only; runs on PGlite, or on TEST_DATABASE_URL (throwaway).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { countRequests, listRequests, recordNotified, reviewRequest } from '@/lib/admin';
import { resetDbForTests, type Db } from '@/lib/db';
import { countsAsOther, duplicateHints, duplicateHintsOn, familyPhones, hintReasons, markDuplicate, normalizeName } from '@/lib/duplicates';
import { queueStatuses, parseQueueView } from '@/lib/queue';
import { listStudentRegistrations, register, type RegistrationInput } from '@/lib/registration';

const YEAR = new Date().getFullYear();
const DAY = 24 * 3600 * 1000;

// ---------------------------------------------------------------- pure rules

test('the flag is off unless DUPLICATE_HINTS is 1 / true / on', () => {
  assert.equal(duplicateHintsOn({}), false);
  for (const v of ['', '0', 'false', 'off', 'yes', ' ']) assert.equal(duplicateHintsOn({ DUPLICATE_HINTS: v }), false, v);
  for (const v of ['1', 'true', 'TRUE', 'on', ' on ']) assert.equal(duplicateHintsOn({ DUPLICATE_HINTS: v }), true, v);
  assert.deepEqual(queueStatuses(false), ['pending', 'accepted', 'rejected']);
  assert.deepEqual(queueStatuses(true), ['pending', 'accepted', 'rejected', 'duplicate']);
  // Off, ?status=duplicate falls back to the waiting list, as any unknown status did before.
  assert.equal(parseQueueView({ status: 'duplicate' }).status, 'pending');
  assert.equal(parseQueueView({ status: 'duplicate' }, queueStatuses(true)).status, 'duplicate');
});

test('phone variants are one phone: Arabic and Persian digits, +964 / 00964 / 964, spaces, the leading 0', () => {
  const variants = ['07701234567', '٠٧٧٠١٢٣٤٥٦٧', '۰۷۷۰۱۲۳۴۵۶۷', '+964 770 123 4567', '00964 7701234567', '9647701234567', '+٩٦٤٧٧٠١٢٣٤٥٦٧', '0770-123-4567'];
  for (const v of variants) assert.deepEqual(familyPhones(v, null), ['07701234567'], v);
  assert.deepEqual(familyPhones('07701234567', '+964 770 123 4567'), ['07701234567']); // same number twice is one phone
  assert.deepEqual(familyPhones('not a phone', ''), []);
});

test('names: hamza, taa marbuta, alif maqsura, tatweel, harakat and spaces do not make a different name', () => {
  assert.equal(normalizeName('  أحمد   علي '), normalizeName('احمد علي'));
  assert.equal(normalizeName('فاطمة حسن'), normalizeName('فاطمه حسن'));
  assert.equal(normalizeName('مرتضى عيسى'), normalizeName('مرتضي عيسي'));
  assert.equal(normalizeName('مُحَمَّد جـاسم'), normalizeName('محمد جاسم'));
  assert.notEqual(normalizeName('محمد جاسم'), normalizeName('محمود جاسم'));
});

test('the pairing rule: same course and a different student, then same phone or same name and birth year', () => {
  const base = { studentId: 1, courseId: 10, name: normalizeName('علي حسن'), birthYear: 2014, phones: ['07701234567'] };
  assert.deepEqual(hintReasons(base, { ...base, studentId: 2 }), ['phone', 'name']);
  assert.deepEqual(hintReasons(base, { ...base, studentId: 2, name: normalizeName('علي حسين') }), ['phone']);
  assert.deepEqual(hintReasons(base, { ...base, studentId: 2, phones: ['07801234567'] }), ['name']);
  assert.deepEqual(hintReasons(base, { ...base, studentId: 2, phones: ['07801234567'], birthYear: 2013 }), []);
  assert.deepEqual(hintReasons(base, { ...base, studentId: 2, courseId: 11 }), [], 'a different course is not a copy');
  assert.deepEqual(hintReasons(base, base), [], 'the same student asking again after a rejection is not a copy');
  // The parent's number typed as the student's phone once and as the guardian's the next time.
  assert.deepEqual(hintReasons({ ...base, phones: ['07701234567'] }, { ...base, studentId: 2, name: 'x', phones: ['07901112222', '07701234567'] }), ['phone']);
});

test('the window: open requests always count, decided ones for 30 days, closed copies never', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  assert.equal(countsAsOther({ status: 'pending', createdAt: ago(90) }, now), true);
  assert.equal(countsAsOther({ status: 'accepted', createdAt: ago(30) }, now), true);
  assert.equal(countsAsOther({ status: 'rejected', createdAt: ago(29.9) }, now), true);
  assert.equal(countsAsOther({ status: 'rejected', createdAt: new Date(ago(30).getTime() - 1) }, now), false);
  assert.equal(countsAsOther({ status: 'accepted', createdAt: ago(31) }, now), false);
  assert.equal(countsAsOther({ status: 'duplicate', createdAt: ago(0) }, now), false);
});

test('closing a copy cannot send anything: the module has no mail, e-mail or WhatsApp import', () => {
  const src = readFileSync('lib/duplicates.ts', 'utf8');
  assert.doesNotMatch(src, /from '\.\/(mail|email|whatsapp)'|fetch\(|sendEmail/);
});

// ---------------------------------------------------------------- database

let db: Db;
let adminId: number;
let tajweed: number;
let nagham: number;

const input = (over: Partial<RegistrationInput>): RegistrationInput => ({
  fullName: 'طالب تجريبي', birthYear: String(YEAR - 25), phone: '07700000000', password: 'password-1',
  guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(tajweed), answers: {}, ...over,
});
/** A minor on a guardian's phone, the usual shape of a re-submission. */
/** The child's own phone defaults to one per family (077… → 075…), so families never share a number by accident. */
const child = (fullName: string, guardianPhone: string, courseId = tajweed, phone = guardianPhone.replace(/^077/, '075')): Partial<RegistrationInput> => ({
  fullName, birthYear: String(YEAR - 11), phone, guardianName: 'ولي أمر تجريبي', guardianPhone, guardianConsent: true, courseId: String(courseId),
});

async function send(over: Partial<RegistrationInput>, duplicateHints = true) {
  const r = await register(db, input(over), { duplicateHints });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}
const setAge = (id: number, days: number) => db.query(`update registrations set created_at = now() - make_interval(secs => $2) where id = $1`, [id, days * 86400]);
const hintIds = async (id: number) => ((await duplicateHints(db, [id])).get(id) ?? []).map((h) => h.id);
const row = async (id: number) => (await db.query<{ status: string; duplicate_of: number | null; reviewed_by: number | null; admin_note: string | null }>('select status, duplicate_of, reviewed_by, admin_note from registrations where id = $1', [id]))[0];

before(async () => {
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'dup@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  const course = async (name: string) => Number((await db.query<{ id: string }>(`insert into courses (name, teacher, published, status) values ($1, 'أستاذ تجريبي', true, 'open') returning id`, [name]))[0].id);
  tajweed = await course('دورة تجويد تجريبية');
  nagham = await course('دورة نغم تجريبية');
});
after(async () => {
  await db.close();
});

test('the migration adds the status and the reference, and nothing personal', async () => {
  const values = await db.query<{ v: string }>(`select unnest(enum_range(null::registration_status))::text as v`);
  assert.deepEqual(values.map((r) => r.v), ['pending', 'accepted', 'rejected', 'duplicate']);
  const cols = await db.query<{ column_name: string; data_type: string }>(`select column_name, data_type from information_schema.columns where table_name = 'registrations' and column_name = 'duplicate_of'`);
  assert.deepEqual(cols, [{ column_name: 'duplicate_of', data_type: 'bigint' }]);
});

test('phone variants on the public form match; the second request is stored, waiting, and marked as a copy', async () => {
  const first = await send(child('حسين علي جاسم', '07711110001'));
  const second = await send(child('حسين على جاسم', '+964 771 111 0001', tajweed, '٠٧٥١١١١٠٠٩٩'));
  assert.equal(first.copyOf, null);
  assert.equal(second.copyOf, first.registrationId);
  assert.deepEqual(await row(second.registrationId), { status: 'pending', duplicate_of: first.registrationId, reviewed_by: null, admin_note: null });
  // Both show the badge, pointing at each other. Nothing is closed or merged.
  assert.deepEqual(await hintIds(second.registrationId), [first.registrationId]);
  assert.deepEqual(await hintIds(first.registrationId), [second.registrationId]);
  assert.equal((await row(first.registrationId)).status, 'pending');
  // The new account's own list knows it is a copy (the thank-you page reads this).
  const mine = await listStudentRegistrations(db, second.studentId);
  assert.deepEqual(mine.map((r) => [r.status, r.copy]), [['pending', true]]);
});

test('the same phone for a different course is not a copy, on the form or in the list', async () => {
  const a = await send(child('زينب كريم حسن', '07711110002'));
  const b = await send(child('زينب كريم حسن', '07711110002', nagham, '07511110003'));
  assert.equal(b.copyOf, null);
  assert.deepEqual(await hintIds(a.registrationId), []);
  assert.deepEqual(await hintIds(b.registrationId), []);
});

test('the same name and birth year on another phone is a hint, but the form only marks phone matches', async () => {
  const a = await send(child('مريم عباس فاضل', '07711110004'));
  const b = await send(child('مريم عباس فاضل', '07811110005', tajweed, '07511110006'));
  assert.equal(b.copyOf, null, 'the thank-you page only says «وصلنا قبل» for the same phone');
  const [hint] = (await duplicateHints(db, [b.registrationId])).get(b.registrationId) ?? [];
  assert.equal(hint.id, a.registrationId);
  assert.deepEqual(hint.reasons, ['name']);
});

test('30-day window: a decided request counts until 30 days, an open one at any age', async () => {
  const old = await send(child('عمار ناصر حميد', '07711110007'));
  const fresh = await send(child('عمار ناصر حميد', '07711110007', tajweed, '07511110008'));
  assert.equal(await reviewRequest(db, adminId, old.registrationId, 'rejected', ''), 'saved');
  await setAge(old.registrationId, 29);
  assert.deepEqual(await hintIds(fresh.registrationId), [old.registrationId]);
  await setAge(old.registrationId, 31);
  assert.deepEqual(await hintIds(fresh.registrationId), [], 'a rejection from 31 days ago is history, not a copy');
  // Still waiting after 60 days: open, so it counts.
  await db.query(`update registrations set status = 'pending', reviewed_by = null, reviewed_at = null where id = $1`, [old.registrationId]);
  await setAge(old.registrationId, 60);
  assert.deepEqual(await hintIds(fresh.registrationId), [old.registrationId]);
  // A form copy also needs the earlier request to be waiting: a decided one does not make «وصلنا قبل».
  assert.equal(await reviewRequest(db, adminId, old.registrationId, 'accepted', ''), 'saved');
  const third = await send(child('عمار ناصر', '07711110007', tajweed, '07511110009'));
  assert.equal(third.copyOf, fresh.registrationId);
});

test('«اعتبره مكرر» closes the copy with an audit row, is not a rejection, and offers no message', async () => {
  const first = await send(child('سجاد محمد كاظم', '07711110010'));
  const copy = await send(child('سجاد محمد كاظم', '07711110010', tajweed, '07511110011'));
  const before = await countRequests(db);
  assert.equal(await markDuplicate(db, adminId, copy.registrationId, first.registrationId), 'saved');
  assert.deepEqual(await row(copy.registrationId), { status: 'duplicate', duplicate_of: first.registrationId, reviewed_by: adminId, admin_note: null });
  const after = await countRequests(db);
  assert.equal(after.rejected, before.rejected, 'not counted as a rejection');
  assert.equal(after.pending, before.pending - 1);
  assert.equal(after.duplicate, before.duplicate + 1);
  const audits = await db.query<{ admin_id: number; action: string; detail: unknown }>(`select admin_id, action, detail from audit_log where target = $1 order by id`, [`registration:${copy.registrationId}`]);
  assert.deepEqual(audits, [{ admin_id: adminId, action: 'registration.duplicate', detail: { of: first.registrationId } }]);
  // No WhatsApp: the «إبلاغ» audit is refused for a closed copy, and nothing else was logged.
  assert.equal(await recordNotified(db, adminId, copy.registrationId), false);
  assert.equal((await db.query(`select 1 from audit_log where action = 'registration.notified' and target = $1`, [`registration:${copy.registrationId}`])).length, 0);
  // The original no longer looks like a copy of the closed one; the closed one gets no badge.
  assert.deepEqual(await hintIds(first.registrationId), []);
  assert.deepEqual(await hintIds(copy.registrationId), []);
  assert.ok((await listRequests(db, 'rejected')).every((r) => r.id !== copy.registrationId));
  assert.deepEqual((await listRequests(db, 'duplicate')).map((r) => [r.id, r.duplicateOf]), [[copy.registrationId, first.registrationId]]);
  // Not a decision about the family: a new request for the course is still allowed (the one-live index ignores it).
  const [{ student_id }] = await db.query<{ student_id: number }>('select student_id from registrations where id = $1', [copy.registrationId]);
  await db.query(`insert into registrations (student_id, course_id) values ($1, $2)`, [student_id, tajweed]);
});

test('«اعتبره مكرر» refuses a decided request, an unrelated one, itself, and an unknown id', async () => {
  const a = await send(child('حيدر سلمان راضي', '07711110012'));
  const b = await send(child('حيدر سلمان راضي', '07711110012', tajweed, '07511110013'));
  const other = await send(child('نور الهدى ياسر', '07711110014'));
  assert.equal(await markDuplicate(db, adminId, b.registrationId, other.registrationId), 'not-a-hint');
  assert.equal(await markDuplicate(db, adminId, b.registrationId, b.registrationId), 'not-a-hint');
  assert.equal(await markDuplicate(db, adminId, 99999999, a.registrationId), 'missing');
  assert.equal(await reviewRequest(db, adminId, b.registrationId, 'accepted', ''), 'saved');
  assert.equal(await markDuplicate(db, adminId, b.registrationId, a.registrationId), 'not-pending');
  // Closing one copy, then trying to close the original as a copy of it: refused (no cycles).
  const c = await send(child('حيدر سلمان راضي', '07711110012', nagham, '07511110015'));
  const d = await send(child('حيدر سلمان راضي', '07711110012', nagham, '07511110016'));
  assert.equal(await markDuplicate(db, adminId, d.registrationId, c.registrationId), 'saved');
  assert.equal(await markDuplicate(db, adminId, c.registrationId, d.registrationId), 'not-a-hint');
  assert.equal((await db.query(`select 1 from audit_log where action = 'registration.duplicate'`)).length, 2);
});

test('flag off: the form stores no copy mark, exactly as before', async () => {
  const a = await send(child('رقية أحمد صالح', '07711110017'), false);
  const b = await send(child('رقيه احمد صالح', '07711110017', tajweed, '07511110018'), false);
  assert.equal(b.copyOf, null);
  assert.equal((await row(b.registrationId)).duplicate_of, null);
  assert.deepEqual((await listStudentRegistrations(db, b.studentId)).map((r) => r.copy), [false]);
  assert.deepEqual(await hintIds(b.registrationId), [a.registrationId], 'the rule itself still matches; only the page decides to show it');
});

test('the admin page and the form read the flag only through duplicateHintsOn()', () => {
  const page = readFileSync('app/admin/page.tsx', 'utf8');
  assert.match(page, /const hintsOn = duplicateHintsOn\(\);/);
  assert.match(page, /hintsOn \? await duplicateHints\(/);
  assert.match(page, /\{hintsOn \? <DuplicateBox/);
  assert.match(readFileSync('app/admin/actions.ts', 'utf8'), /if \(!duplicateHintsOn\(\) \|\|/);
  assert.match(readFileSync('app/account/page.tsx', 'utf8'), /const again = duplicateHintsOn\(\) &&/);
});
