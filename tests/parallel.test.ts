import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAdmin, loginAdmin, loginStudent } from '@/lib/accounts';
import { allowRegistration, totpAt } from '@/lib/auth';
import { resetDbForTests, type Db } from '@/lib/db';
import { register } from '@/lib/registration';

// The limits must hold when requests arrive at the same time, not only one after another
// (review of 7d94546: a burst of 300 parallel wrong passwords on one phone was checked 300 times).

let db: Db;
let totpSecret: string;

before(async () => {
  db = await resetDbForTests();
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة تجريبية', 'tajweed', 'أستاذ تجريبي', true) returning id`);
  const r = await register(db, {
    fullName: 'طالب متوازٍ تجريبي', birthYear: String(new Date().getFullYear() - 30), phone: '07766666666', password: 'right-password',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(c.id), answers: {},
  });
  assert.ok(r.ok);
  totpSecret = (await createAdmin(db, { name: 'مدير تجريبي', email: 'race@example.test', password: 'a-long-test-password', role: 'owner' })).totpSecret;
});
after(async () => {
  await db.close();
});

test('parallel wrong passwords on one phone: at most 5 are checked', async () => {
  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => loginStudent(db, '07766666666', `guess-${i}`, `10.1.0.${i}`)));
  const checked = rs.filter((r) => !r.ok && r.reason === 'invalid').length;
  assert.ok(checked <= 5, `${checked} passwords were checked`);
  assert.deepEqual(await loginStudent(db, '07766666666', 'right-password', '10.1.1.1'), { ok: false, reason: 'throttled' });
});

test('parallel wrong passwords from one address: at most 20 are checked', async () => {
  await db.query('delete from login_attempts');
  const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => loginStudent(db, `0777${String(1000000 + i)}`, 'guess', '10.2.0.1')));
  const checked = rs.filter((r) => !r.ok && r.reason === 'invalid').length;
  assert.ok(checked <= 20, `${checked} passwords were checked`);
});

test('a refused attempt does not extend the lock', async () => {
  await db.query('delete from login_attempts');
  for (let i = 0; i < 5; i++) await loginStudent(db, '07766666666', `guess-${i}`, '10.3.0.1');
  for (let i = 0; i < 10; i++) assert.deepEqual(await loginStudent(db, '07766666666', 'x', '10.3.0.1'), { ok: false, reason: 'throttled' });
  const [{ n }] = await db.query<{ n: string }>(`select count(*) as n from login_attempts where identifier = '07766666666'`);
  assert.equal(Number(n), 5);
  await db.query('delete from login_attempts');
});

test('one TOTP code used by two parallel logins: only one gets in', async () => {
  await db.query('delete from login_attempts');
  const code = totpAt(totpSecret, Date.now());
  const rs = await Promise.all([1, 2, 3].map((i) => loginAdmin(db, 'race@example.test', 'a-long-test-password', code, `10.4.0.${i}`)));
  assert.equal(rs.filter((r) => r.ok).length, 1);
});

test('parallel registrations from one address: at most 8 pass the limit', async () => {
  const rs = await Promise.all(Array.from({ length: 30 }, () => allowRegistration(db, '10.5.0.1')));
  assert.equal(rs.filter(Boolean).length, 8);
});

test('wrong admin logins from other addresses do not lock the admin out', async () => {
  await db.query('delete from login_attempts');
  for (let i = 0; i < 10; i++) await loginAdmin(db, 'race@example.test', 'nope', '000000', `10.6.0.${i}`);
  await db.query('update admins set totp_last_step = null');
  assert.ok((await loginAdmin(db, 'race@example.test', 'a-long-test-password', totpAt(totpSecret, Date.now()), '10.6.1.1')).ok);
  for (let i = 0; i < 5; i++) await loginAdmin(db, 'race@example.test', 'nope', '000000', '10.6.2.1');
  assert.deepEqual(await loginAdmin(db, 'race@example.test', 'nope', '000000', '10.6.2.1'), { ok: false, reason: 'throttled' }, 'one address still gets 5 tries');
});
