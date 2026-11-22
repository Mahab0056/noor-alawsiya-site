// Public course pages: which record courses take registrations now, new panel courses, JSON-LD. Invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { addCourse, setCourseAccepting } from '@/lib/courses';
import { COURSES, HOME_COURSES } from '@/lib/data';
import { resetDbForTests, type Db } from '@/lib/db';
import { coursesCount, homeCourses, matchCourses, nameKey, readPublishedCourses } from '@/lib/public-courses';
import { pickCourse } from '@/lib/form-rules';
import { coursesLd, ldJson } from '@/lib/seo';

let db: Db;
let adminId: number;
const ids: Record<string, number> = {};

before(async () => {
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'public-courses@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  // As the seed writes them: every record course, registration closed.
  for (const c of COURSES) {
    const [row] = await db.query<{ id: string }>(
      'insert into courses (name, kind, description, teacher, place, started_on, status, published) values ($1, $2, $3, $4, $5, $6, $7, false) returning id',
      [c.name, c.kind, c.kindLabel, c.teacher, c.place, c.start, c.status],
    );
    ids[c.name] = Number(row.id);
  }
});
after(async () => {
  await db.close();
});

const view = async () => matchCourses(COURSES, await readPublishedCourses(db));
const RUNNING = COURSES.filter((c) => c.status === 'open');

test('a fresh seed: no course takes registrations, nothing new, no JSON-LD', async () => {
  const v = await view();
  assert.deepEqual(v.openByName, {});
  assert.deepEqual(v.extra, []);
  assert.deepEqual(v.open, []);
  assert.equal(coursesLd(v.open), null);
});

test('only the courses opened in the panel get a badge, with their database id', async () => {
  const [a, b] = [RUNNING[1], RUNNING[4]];
  await setCourseAccepting(db, adminId, ids[a.name], true);
  await setCourseAccepting(db, adminId, ids[b.name], true);
  const v = await view();
  assert.deepEqual(v.openByName, { [a.name]: ids[a.name], [b.name]: ids[b.name] });
  assert.deepEqual(v.extra, [], 'record courses are never listed as new');
  // The other running courses keep the record text: no badge.
  for (const c of RUNNING) if (c !== a && c !== b) assert.equal(v.openByName[c.name], undefined, c.name);

  await setCourseAccepting(db, adminId, ids[b.name], false);
  assert.deepEqual((await view()).openByName, { [a.name]: ids[a.name] });
  await setCourseAccepting(db, adminId, ids[a.name], false);
});

test('a published course that is not open (status changed by hand) gets no badge', async () => {
  const c = RUNNING[0];
  await db.query(`update courses set published = true, status = 'unknown' where id = $1`, [ids[c.name]]);
  assert.deepEqual((await view()).openByName, {});
  await db.query(`update courses set published = false, status = 'open' where id = $1`, [ids[c.name]]);
});

test('names match after trimming and collapsing spaces', () => {
  const c = RUNNING[2];
  const v = matchCourses(COURSES, [{ id: 99, name: `  ${c.name.replace(' ', '   ')} `, kind: null, description: null, teacher: 'x', place: null, startedOn: null, status: 'open', accepting: true }]);
  assert.deepEqual(v.openByName, { [c.name]: 99 });
  assert.equal(nameKey(' a  b '), 'a b');
});

test('two rows with one record name: the open one is used', () => {
  const c = RUNNING[3];
  const row = { name: c.name, kind: null, description: null, teacher: 'x', place: null, startedOn: null, status: 'open' as const };
  const v = matchCourses(COURSES, [{ ...row, id: 5, status: 'unknown', accepting: false }, { ...row, id: 6, accepting: true }]);
  assert.deepEqual(v.openByName, { [c.name]: 6 });
  assert.equal(v.open.length, 1);
});

test('courses added in the panel: published ones are listed as new, closed (unpublished) ones stay hidden', async () => {
  const openId = await addCourse(db, adminId, { name: 'دورة   تجريبية مفتوحة', teacher: 'أستاذ تجريبي', place: 'مكان تجريبي', startedOn: 'كانون الثاني ٢٠٢٧', open: true });
  await addCourse(db, adminId, { name: 'دورة تجريبية مغلقة', teacher: 'أستاذ تجريبي', place: '', startedOn: '', open: false });
  const v = await view();
  assert.equal(v.extra.length, 1);
  const [x] = v.extra;
  assert.equal(x.id, openId);
  assert.equal(x.name, 'دورة تجريبية مفتوحة');
  assert.equal(x.accepting, true);
  assert.equal(x.place, 'مكان تجريبي');
  assert.equal(x.start, 'كانون الثاني ٢٠٢٧');
  assert.deepEqual(v.open, [{ id: openId, name: 'دورة تجريبية مفتوحة', description: null }]);

  // Closing it in the panel unpublishes it: it leaves the public page.
  await setCourseAccepting(db, adminId, openId, false);
  assert.deepEqual((await view()).extra, []);
});

test('JSON-LD lists Course items only for open courses, each linking to its registration', async () => {
  const c = RUNNING[1];
  await setCourseAccepting(db, adminId, ids[c.name], true);
  const ld = coursesLd((await view()).open)!;
  assert.equal(ld.itemListElement.length, 1);
  const item = ld.itemListElement[0].item;
  assert.equal(item['@type'], 'Course');
  assert.equal(item.name, c.name);
  assert.equal(item.url, `https://noor-alawsiya.com/register?course=${ids[c.name]}`);
  assert.equal(item.description, c.kindLabel);
  assert.deepEqual(JSON.parse(ldJson(ld)), ld);
  await setCourseAccepting(db, adminId, ids[c.name], false);
});

test('home cards: open courses first, then the usual six; without the database, the usual six', () => {
  assert.deepEqual(homeCourses(COURSES, HOME_COURSES, null), HOME_COURSES);
  const open = RUNNING.filter((c) => !HOME_COURSES.includes(c)).slice(0, 2);
  const v = matchCourses(COURSES, open.map((c, i) => ({ id: i + 1, name: c.name, kind: null, description: null, teacher: c.teacher, place: null, startedOn: null, status: 'open', accepting: true })));
  const cards = homeCourses(COURSES, HOME_COURSES, v);
  assert.equal(cards.length, 6);
  assert.deepEqual(cards.slice(0, 2), open);
  assert.deepEqual(cards.slice(2), HOME_COURSES.slice(0, 4));
});

test('course counts read naturally', () => {
  assert.equal(coursesCount(1), 'دورة واحدة');
  assert.equal(coursesCount(2), 'دورتين');
  assert.equal(coursesCount(3), '٣ دورات');
  assert.equal(coursesCount(11), '١١ دورة');
});

test('pages: every badge and «سجّل» link comes from the database view, and the pages survive a null view', () => {
  const card = readFileSync('components/Cards.tsx', 'utf8');
  assert.match(card, /href=\{`\/register\?course=\$\{openId\}`\}/);
  assert.ok(!card.includes("course.status === 'open' ?"), 'the record status alone must not offer registration');
  for (const page of ['app/page.tsx', 'app/courses/page.tsx']) {
    const src = readFileSync(page, 'utf8');
    assert.match(src, /const live = await getPublicCourses\(\);/, page);
    assert.ok(src.includes('openId={live?.openByName[c.name]}') || src.includes('const openId = live?.openByName[c.name];'), page);
  }
  // The admin actions expire the public cache, so a change shows at once.
  const actions = readFileSync('app/admin/courses/actions.ts', 'utf8');
  assert.equal(actions.match(/updateTag\(PUBLIC_COURSES_TAG\)/g)?.length, 2);
  // No database during `next build`.
  const cache = readFileSync('lib/public-courses-cache.ts', 'utf8');
  assert.match(cache, /NEXT_PHASE === 'phase-production-build'\) \{\s*cacheLife\(RETRY_SOON\);\s*return null;/);
  // Every null result is retried soon; only a real answer is kept for the minute.
  assert.equal(cache.match(/cacheLife\(RETRY_SOON\);\s*return null;/g)?.length, 2);
});

test('/register preselects by id from the public pages, and still by name for older links', () => {
  // After the merge with register-form-ux the page uses its pickCourse() (lib/form-rules.ts), which takes an id or a name.
  const src = readFileSync('app/register/page.tsx', 'utf8');
  assert.match(src, /pickCourse\(courses, wanted\)/);
  const open = [{ id: 7, name: 'دورة السيدة نرجس (ع)' }, { id: 9, name: 'دورة أخرى' }] as Parameters<typeof pickCourse>[0];
  assert.equal(pickCourse(open, '7'), 7);
  assert.equal(pickCourse(open, 'دورة السيدة نرجس (ع)'), 7);
  assert.equal(pickCourse(open, '8'), undefined);
});
