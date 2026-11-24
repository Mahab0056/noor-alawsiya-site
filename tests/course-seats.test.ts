// «عدد المقاعد» per course (0015, COURSE_SEATS): the last accepted seat closes registration in the same transaction.
// Invented data only. Runs on PGlite and, with TEST_DATABASE_URL, on a throwaway Postgres (real parallel connections).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { reviewRequest } from '@/lib/admin';
import { addCourse, listCoursesForAdmin, setCourseAccepting, setCourseSeats, validateCourse } from '@/lib/courses';
import { resetDbForTests, type Db } from '@/lib/db';
import { matchCourses, readPublishedCourses } from '@/lib/public-courses';
import { listOpenCourses } from '@/lib/registration';
import { courseSeatsOn, parseSeats, seatsCount, seatsLeft, seatsLeftLabel, showSeatsBadge } from '@/lib/seats';

const ON = true;
const OFF = false;
let db: Db;
let adminId: number;
let otherAdmin: number;
let n = 0;

before(async () => {
  delete process.env.COURSE_SEATS; // the default the rest of the suite runs with: OFF
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'seats@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  otherAdmin = (await createAdmin(db, { name: 'مدير ثان', email: 'seats2@example.test', password: 'a-long-test-password', role: 'staff' })).adminId;
});
after(async () => {
  await db.close();
});

async function course(seats: number | null, published = true): Promise<number> {
  const [r] = await db.query<{ id: string }>(`insert into courses (name, teacher, status, published, seats) values ($1, 'أستاذ تجريبي', 'open', $2, $3) returning id`, [`دورة مقاعد ${++n}`, published, seats]);
  return Number(r.id);
}

/** k pending requests for a course, from k invented adult students. */
async function requests(courseId: number, k: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < k; i++) {
    const [s] = await db.query<{ id: string }>(`insert into students (full_name, birth_year, phone, password_hash) values ($1, 1990, $2, 'x') returning id`, [`طالب تجريبي ${++n}`, `0770${String(n).padStart(7, '0')}`]);
    const [r] = await db.query<{ id: string }>('insert into registrations (student_id, course_id) values ($1, $2) returning id', [s.id, courseId]);
    ids.push(Number(r.id));
  }
  return ids;
}

const published = async (id: number) => (await db.query<{ published: boolean }>('select published from courses where id = $1', [id]))[0].published;
const accepted = async (id: number) => Number((await db.query<{ n: string }>(`select count(*) as n from registrations where course_id = $1 and status = 'accepted'`, [id]))[0].n);
const statusOf = async (id: number) => (await db.query<{ status: string }>('select status from registrations where id = $1', [id]))[0].status;

test('COURSE_SEATS is OFF unless set to 1/true/on', () => {
  assert.equal(courseSeatsOn({}), false);
  assert.equal(courseSeatsOn({ COURSE_SEATS: '' }), false);
  assert.equal(courseSeatsOn({ COURSE_SEATS: '0' }), false);
  assert.equal(courseSeatsOn({ COURSE_SEATS: 'off' }), false);
  for (const v of ['1', 'true', 'ON', ' on ']) assert.equal(courseSeatsOn({ COURSE_SEATS: v }), true, v);
});

test('the seats box: empty = no limit, 1..1000, Arabic digits read; the labels use Arabic digits', () => {
  assert.deepEqual(parseSeats(''), { ok: true, value: null });
  assert.deepEqual(parseSeats('  '), { ok: true, value: null });
  assert.deepEqual(parseSeats('12'), { ok: true, value: 12 });
  assert.deepEqual(parseSeats('١٢'), { ok: true, value: 12 });
  assert.deepEqual(parseSeats('۳'), { ok: true, value: 3 });
  for (const bad of ['0', '-1', '1001', '2.5', 'abc', '1e3', '12345']) assert.equal(parseSeats(bad).ok, false, bad);
  assert.equal(seatsLeftLabel(1), 'باقي مقعد واحد');
  assert.equal(seatsLeftLabel(2), 'باقي مقعدان');
  assert.equal(seatsLeftLabel(3), 'باقي ٣ مقاعد');
  assert.equal(seatsLeftLabel(5), 'باقي ٥ مقاعد');
  assert.equal(seatsCount(12), '١٢ مقعداً');
  assert.equal(seatsLeft(null, 9), null);
  assert.equal(seatsLeft(3, 5), 0);
});

test('the badge shows only at 5 seats left or fewer, and never at 0 (a full course shows as closed)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(showSeatsBadge), [false, true, true, true, true, true, false, false]);
  assert.equal(showSeatsBadge(null), false);
  assert.equal(showSeatsBadge(undefined), false);
});

test('limit reached: the accept that takes the last seat closes registration in the same transaction', async () => {
  const c = await course(3);
  const [a, b, d, e] = await requests(c, 4);
  assert.equal(await reviewRequest(db, adminId, a, 'accepted', '', ON), 'saved');
  assert.equal(await reviewRequest(db, adminId, b, 'accepted', '', ON), 'saved');
  assert.equal(await published(c), true);
  assert.equal(await reviewRequest(db, adminId, d, 'accepted', '', ON), 'closed');
  assert.equal(await published(c), false);
  assert.ok(!(await listOpenCourses(db, ON)).some((x) => x.id === c), 'gone from /register and «حسابي»');
  const log = await db.query<{ action: string; detail: unknown }>(`select action, detail from audit_log where target = $1 order by id`, [`course:${c}`]);
  assert.deepEqual(log, [{ action: 'course.closed', detail: { reason: 'full' } }]);
  // A fourth accept is refused and changes nothing: «اكتملت الدورة».
  assert.equal(await reviewRequest(db, otherAdmin, e, 'accepted', '', ON), 'full');
  assert.equal(await statusOf(e), 'pending');
  assert.equal(await accepted(c), 3);
  // Rejecting is always allowed.
  assert.equal(await reviewRequest(db, otherAdmin, e, 'rejected', '', ON), 'saved');
});

test('concurrent accepts of the last seat: exactly one wins, the others see «اكتملت الدورة»', async () => {
  const c = await course(3);
  const ids = await requests(c, 7);
  for (const id of ids.slice(0, 2)) assert.equal(await reviewRequest(db, adminId, id, 'accepted', '', ON), 'saved');
  const results = await Promise.all(ids.slice(2).map((id, i) => reviewRequest(db, i % 2 ? adminId : otherAdmin, id, 'accepted', '', ON)));
  assert.equal(results.filter((r) => r === 'closed').length, 1, results.join(','));
  assert.equal(results.filter((r) => r === 'full').length, 4, results.join(','));
  assert.equal(await accepted(c), 3);
  assert.equal(await published(c), false);
});

test('concurrent: an admin reopening a course while another accepts its last seat never leaves it open and full', async () => {
  for (let round = 0; round < 5; round++) {
    const c = await course(1, false);
    const [r] = await requests(c, 1);
    const [opened, review] = await Promise.all([setCourseAccepting(db, otherAdmin, c, true, ON), reviewRequest(db, adminId, r, 'accepted', '', ON)]);
    // Either order is fine; what may never happen is «open» with every seat taken.
    assert.ok(!((await published(c)) && (await accepted(c)) >= 1), `round ${round}: ${opened}/${review}`);
  }
});

test('empty limit = no change: any number of accepts, and the course stays open', async () => {
  const c = await course(null);
  for (const id of await requests(c, 6)) assert.equal(await reviewRequest(db, adminId, id, 'accepted', '', ON), 'saved');
  assert.equal(await published(c), true);
  const open = (await listOpenCourses(db, ON)).find((x) => x.id === c);
  assert.ok(open);
  assert.ok(!('seatsLeft' in open), 'no limit, no seat count');
});

test('flag OFF: a stored limit is ignored, nothing closes by itself and the queries are as before', async () => {
  const c = await course(1);
  const ids = await requests(c, 3);
  for (const id of ids) assert.equal(await reviewRequest(db, adminId, id, 'accepted', '', OFF), 'saved');
  assert.equal(await published(c), true);
  assert.equal(await setCourseAccepting(db, adminId, c, true, OFF), 'saved');
  const open = (await listOpenCourses(db, OFF)).find((x) => x.id === c);
  assert.deepEqual(Object.keys(open!).sort(), ['id', 'kind', 'name', 'place', 'teacher']);
  const rows = await readPublishedCourses(db, OFF);
  assert.ok(rows.every((r) => !('seatsLeft' in r)));
  assert.ok(!('seatsLeft' in matchCourses([], rows)), 'the public view has no seats key with the flag OFF');
  // The defaults read the environment, which is OFF in the test run.
  assert.equal(await reviewRequest(db, adminId, (await requests(c, 1))[0], 'accepted', ''), 'saved');
});

test('re-deciding: re-accepting an accepted request takes no second seat; a reject frees a seat but never reopens', async () => {
  const c = await course(2);
  const [a, b, d] = await requests(c, 3);
  assert.equal(await reviewRequest(db, adminId, a, 'accepted', '', ON), 'saved');
  assert.equal(await reviewRequest(db, adminId, a, 'accepted', 'ملاحظة', ON), 'saved', 'the same seat');
  assert.equal(await reviewRequest(db, adminId, b, 'accepted', '', ON), 'closed');
  assert.equal(await reviewRequest(db, adminId, b, 'accepted', '', ON), 'saved', 're-saving an accepted request in a full course');
  assert.equal(await reviewRequest(db, adminId, a, 'rejected', '', ON), 'saved');
  assert.equal(await published(c), false, 'reopening stays manual');
  // The freed seat can be given while registration stays closed.
  assert.equal(await reviewRequest(db, adminId, d, 'accepted', '', ON), 'saved');
  assert.equal(await published(c), false);
});

test('«الدورات»: a full course cannot be reopened until the number is raised; lowering it closes at once', async () => {
  const c = await course(2);
  for (const id of await requests(c, 2)) await reviewRequest(db, adminId, id, 'accepted', '', ON);
  assert.equal(await published(c), false);
  assert.equal(await setCourseAccepting(db, adminId, c, true, ON), 'full');
  assert.equal(await published(c), false);
  assert.equal(await setCourseSeats(db, adminId, c, 5), 'saved');
  assert.equal(await published(c), false, 'raising the number does not reopen by itself');
  assert.equal(await setCourseAccepting(db, adminId, c, true, ON), 'saved');
  assert.equal((await listOpenCourses(db, ON)).find((x) => x.id === c)?.seatsLeft, 3);
  assert.equal(await setCourseSeats(db, adminId, c, 2), 'closed');
  assert.equal(await published(c), false);
  assert.equal(await setCourseSeats(db, adminId, c, null), 'saved');
  assert.equal(await setCourseAccepting(db, adminId, c, true, ON), 'saved', 'no limit: opens again');
  assert.equal(await setCourseSeats(db, adminId, 999999, 3), 'missing');
  const row = (await listCoursesForAdmin(db)).find((x) => x.id === c);
  assert.equal(row?.seats, null);
  const log = await db.query<{ action: string; detail: unknown }>(`select action, detail from audit_log where target = $1 and action = 'course.seats' order by id`, [`course:${c}`]);
  assert.deepEqual(log.map((l) => l.detail), [{ seats: 5 }, { seats: 2 }, { seats: null }]);
});

test('seats left reach /register and the public view; the badge numbers follow accepts', async () => {
  const c = await course(6);
  const ids = await requests(c, 6);
  const left = async () => (await listOpenCourses(db, ON)).find((x) => x.id === c)?.seatsLeft;
  assert.equal(await left(), 6);
  assert.equal(showSeatsBadge(await left()), false);
  await reviewRequest(db, adminId, ids[0], 'accepted', '', ON);
  assert.equal(await left(), 5);
  assert.equal(showSeatsBadge(await left()), true);
  await reviewRequest(db, adminId, ids[1], 'accepted', '', ON);
  await reviewRequest(db, adminId, ids[2], 'accepted', '', ON);
  const view = matchCourses([], await readPublishedCourses(db, ON));
  assert.equal(view.seatsLeft?.[c], 3);
  assert.equal(seatsLeftLabel(view.seatsLeft![c]), 'باقي ٣ مقاعد');
  // Pending requests take no seat.
  assert.equal((await listCoursesForAdmin(db)).find((x) => x.id === c)?.pending, 3);
});

test('«دورة جديدة» takes a seat number only when the form sent one', async () => {
  const off = validateCourse({ name: 'دورة جديدة', teacher: 'أستاذ تجريبي', place: '', startedOn: '', open: true });
  assert.ok(off.ok && !('seats' in off.value));
  const bad = validateCourse({ name: 'دورة جديدة', teacher: 'أستاذ تجريبي', place: '', startedOn: '', open: true, seats: '0' });
  assert.ok(!bad.ok && bad.errors.seats);
  const good = validateCourse({ name: 'دورة بمقاعد', teacher: 'أستاذ تجريبي', place: '', startedOn: '', open: true, seats: '١٥' });
  assert.ok(good.ok);
  const id = await addCourse(db, adminId, good.value);
  assert.equal((await listCoursesForAdmin(db)).find((x) => x.id === id)?.seats, 15);
  const empty = validateCourse({ name: 'دورة بلا حد', teacher: 'أستاذ تجريبي', place: '', startedOn: '', open: true, seats: '' });
  assert.ok(empty.ok);
  const id2 = await addCourse(db, adminId, empty.value);
  assert.equal((await listCoursesForAdmin(db)).find((x) => x.id === id2)?.seats, null);
});

test('0015: a nullable column with a range check, and no backfill', async () => {
  const [col] = await db.query<{ is_nullable: string; data_type: string }>(`select is_nullable, data_type from information_schema.columns where table_name = 'courses' and column_name = 'seats'`);
  assert.deepEqual(col, { is_nullable: 'YES', data_type: 'integer' });
  await assert.rejects(db.query(`insert into courses (name, teacher, seats) values ('x', 'y', 0)`));
  await assert.rejects(db.query(`insert into courses (name, teacher, seats) values ('x', 'y', 1001)`));
  const sql = readFileSync('db/migrations/0015_course_seats.sql', 'utf8').replace(/--.*$/gm, '');
  assert.ok(!/\bupdate\b|\binsert\b|\bdefault\b/i.test(sql), 'no backfill and no default');
});

test('flag OFF in the app code: the field, the notices and the cache refresh all sit behind courseSeatsOn()', () => {
  const page = readFileSync('app/admin/courses/page.tsx', 'utf8');
  assert.match(page, /const seatsOn = courseSeatsOn\(\);/);
  assert.match(page, /\{seatsOn \? <SeatsNotice/);
  assert.match(page, /\{seatsOn \? <SeatsMeta/);
  assert.match(page, /\{seatsOn && c\.status !== 'done' \? \(/);
  assert.match(page, /<CourseForm seats=\{seatsOn\} \/>/);
  const actions = readFileSync('app/admin/actions.ts', 'utf8');
  assert.match(actions, /if \(courseSeatsOn\(\)\) \{\s*updateTag\(PUBLIC_COURSES_TAG\);/);
  const admin = readFileSync('app/admin/page.tsx', 'utf8');
  assert.equal(admin.match(/&& courseSeatsOn\(\) \?/g)?.length, 2);
  const courseActions = readFileSync('app/admin/courses/actions.ts', 'utf8');
  assert.match(courseActions, /if \(!courseSeatsOn\(\)\) return;/);
  assert.match(courseActions, /\.\.\.\(courseSeatsOn\(\) \? \{ seats: text\(form, 'seats'\) \} : \{\}\)/);
});
