// Gallery and admin team on an in-memory PGlite database. Invented data only.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAdmin, getAdmin } from '@/lib/accounts';
import { ADMIN_REMEMBER_MS, createSession, destroySession, readSession } from '@/lib/auth';
import { resetDbForTests, type Db } from '@/lib/db';
import { addGalleryImage, deleteGalleryImage, GalleryError, getGalleryImage, listGallery, MAX_IMAGE_BYTES, moveGalleryImage, setGalleryCaption, sniffImage } from '@/lib/gallery';
import { addTeamMember, listTeam, removeTeamMember, TeamError } from '@/lib/team';

let db: Db;
let first: number;
// Migration 0005 seeds the school's first admin; these tests look only at the admins they create.
const mine = async () => (await listTeam(db)).filter((m) => m.email.endsWith('@example.test'));

// The smallest headers that identify each type; the rest of the bytes are filler.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const code = (p: Promise<unknown>, expected: string) =>
  assert.rejects(p, (e: Error) => (e instanceof GalleryError || e instanceof TeamError) && e.code === expected, `expected the error code ${expected}`);

before(async () => {
  db = await resetDbForTests();
  first = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'first@example.test' })).adminId;
});
after(async () => {
  await db.close();
});

test('every admin is a super admin: new ones by default, old staff rows after the migration', async () => {
  assert.equal((await getAdmin(db, first))?.role, 'owner');
  const [{ column_default }] = await db.query<{ column_default: string }>(`select column_default from information_schema.columns where table_name = 'admins' and column_name = 'role'`);
  assert.match(column_default, /owner/);
  // A row written the old way, then the same statement the migration runs.
  const [old] = await db.query<{ id: string }>(`insert into admins (name, email, role) values ('مشرف قديم', 'old@example.test', 'staff') returning id`);
  await db.query(`update admins set role = 'owner'`);
  assert.equal((await getAdmin(db, Number(old.id)))?.role, 'owner');
  await db.query('delete from admins where id = $1', [old.id]);
});

test('the file type comes from the bytes, not from the name', () => {
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(WEBP), 'image/webp');
  assert.equal(sniffImage(SVG), null);
  assert.equal(sniffImage(new Uint8Array()), null);
});

test('pictures are added, read back, captioned, reordered and deleted', async () => {
  const a = await addGalleryImage(db, first, { bytes: JPEG, caption: '  محفل التخرّج  ', width: 1600, height: 1200 });
  const b = await addGalleryImage(db, first, { bytes: PNG, caption: '', width: 800, height: 800 });
  const c = await addGalleryImage(db, first, { bytes: WEBP, caption: 'حلقة التجويد', width: Number.NaN, height: -4 });
  assert.deepEqual((await listGallery(db)).map((g) => g.id), [a, b, c]);
  assert.deepEqual((await listGallery(db))[0], { id: a, caption: 'محفل التخرّج', width: 1600, height: 1200 });
  assert.deepEqual([(await listGallery(db))[2].width, (await listGallery(db))[2].height], [1200, 900], 'a bad size falls back to 4:3');

  const stored = await getGalleryImage(db, b);
  assert.equal(stored?.mime, 'image/png');
  assert.deepEqual(Array.from(stored!.bytes), Array.from(PNG));
  assert.equal(await getGalleryImage(db, 999999), null);

  await setGalleryCaption(db, first, b, 'ختمة رمضان');
  assert.equal((await listGallery(db))[1].caption, 'ختمة رمضان');

  await moveGalleryImage(db, first, c, 'up');
  assert.deepEqual((await listGallery(db)).map((g) => g.id), [a, c, b]);
  await moveGalleryImage(db, first, a, 'up'); // already first: nothing moves
  assert.deepEqual((await listGallery(db)).map((g) => g.id), [a, c, b]);

  await deleteGalleryImage(db, first, c);
  assert.deepEqual((await listGallery(db)).map((g) => g.id), [a, b]);
  assert.equal(await getGalleryImage(db, c), null);

  const actions = (await db.query<{ action: string }>(`select action from audit_log where action like 'gallery.%' order by id`)).map((r) => r.action);
  assert.deepEqual(actions, ['gallery.add', 'gallery.add', 'gallery.add', 'gallery.caption', 'gallery.move', 'gallery.delete']);
});

test('a file that is not a picture, an empty one, a huge one and a long caption are refused', async () => {
  const before = (await listGallery(db)).length;
  await code(addGalleryImage(db, first, { bytes: SVG, caption: '', width: 10, height: 10 }), 'bad-type');
  await code(addGalleryImage(db, first, { bytes: new Uint8Array(), caption: '', width: 10, height: 10 }), 'empty');
  const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
  huge.set(JPEG);
  await code(addGalleryImage(db, first, { bytes: huge, caption: '', width: 10, height: 10 }), 'too-big');
  await code(addGalleryImage(db, first, { bytes: JPEG, caption: 'ط'.repeat(141), width: 10, height: 10 }), 'caption');
  await code(setGalleryCaption(db, first, 1, 'ط'.repeat(141)), 'caption');
  assert.equal((await listGallery(db)).length, before);
});

test('an admin adds another super admin and removes them; nobody removes themselves', async () => {
  const second = await addTeamMember(db, first, { name: 'مشرف ثانٍ', email: '  Second@Example.test ' });
  assert.equal((await getAdmin(db, second))?.role, 'owner');
  assert.deepEqual((await mine()).map((m) => m.email), ['first@example.test', 'second@example.test']);

  await code(addTeamMember(db, first, { name: 'مكرر', email: 'SECOND@example.test' }), 'exists');
  await code(addTeamMember(db, first, { name: 'بلا بريد', email: 'not-an-address' }), 'email');
  await code(addTeamMember(db, first, { name: ' ', email: 'third@example.test' }), 'name');
  await code(removeTeamMember(db, first, first), 'self');

  // The new admin has the same powers: they can remove the first one, whose session then stops working.
  const { token } = await createSession(db, 'admin', first);
  assert.equal((await readSession(db, token))?.userId, first);
  await removeTeamMember(db, second, first);
  assert.equal(await readSession(db, token), null);
  assert.deepEqual((await mine()).map((m) => m.id), [second]);
  await code(removeTeamMember(db, second, second), 'self');

  // Pictures the removed admin uploaded stay in the gallery.
  assert.ok((await listGallery(db)).length > 0);
});

test('«تذكّر هذا المتصفح» keeps an admin session for 60 days; without it the session lasts 12 hours', async () => {
  const [{ id }] = await db.query<{ id: string }>(`select id from admins where email = 'second@example.test'`);
  const admin = Number(id);
  const near = (d: Date, ms: number) => Math.abs(d.getTime() - Date.now() - ms) < 60_000;

  const short = await createSession(db, 'admin', admin);
  assert.ok(near(short.expiresAt, 12 * 3600_000));
  const long = await createSession(db, 'admin', admin, { remember: true });
  assert.ok(near(long.expiresAt, ADMIN_REMEMBER_MS));
  assert.ok(near((await readSession(db, long.token))!.expiresAt, ADMIN_REMEMBER_MS));

  // Signing out ends the remembered session at once, and a student session never takes the long life.
  await destroySession(db, long.token);
  assert.equal(await readSession(db, long.token), null);
  const [s] = await db.query<{ id: string }>(`insert into students (full_name, birth_year, phone, password_hash) values ('طالب تجريبي', 1995, '07700000055', 'x') returning id`);
  const student = await createSession(db, 'student', Number(s.id), { remember: true });
  assert.ok(near(student.expiresAt, 30 * 24 * 3600_000));
});
