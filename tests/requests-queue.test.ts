// The admin «طلبات التسجيل» queue: oldest waiting first, waiting-time badge (amber 24 h, red 48 h), course and status
// filters, the summary on the admin home, and the admin-only guard. Invented data only.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { countRequests, listCourseFilterOptions, listRequests, oldestPendingAt, reviewRequest } from '@/lib/admin';
import { resetDbForTests, type Db } from '@/lib/db';
import { defaultSort, HOUR, parseQueueView, pendingSummary, queueHref, waitBadgeText, waitedText, waitLevel, WAIT_TAG } from '@/lib/queue';
import { register } from '@/lib/registration';

const NOW = new Date('2026-11-21T09:00:00Z'); // 12:00 in Baghdad
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

// ---------------------------------------------------------------- badge thresholds

test('badge level: 23:59 is neutral, 24:00 turns amber, 47:59 is still amber, 48:00 turns red', () => {
  assert.equal(waitLevel(ago(0), NOW), 'fresh');
  assert.equal(waitLevel(ago(23 * HOUR + 59 * MIN), NOW), 'fresh');
  assert.equal(waitLevel(ago(24 * HOUR - 1), NOW), 'fresh');
  assert.equal(waitLevel(ago(24 * HOUR), NOW), 'late');
  assert.equal(waitLevel(ago(47 * HOUR + 59 * MIN), NOW), 'late');
  assert.equal(waitLevel(ago(48 * HOUR - 1), NOW), 'late');
  assert.equal(waitLevel(ago(48 * HOUR), NOW), 'overdue');
  assert.equal(waitLevel(ago(30 * 24 * HOUR), NOW), 'overdue');
  // A request dated after "now" (clock skew) has just arrived.
  assert.equal(waitLevel(new Date(NOW.getTime() + 5 * MIN), NOW), 'fresh');
  assert.deepEqual(WAIT_TAG, { fresh: 'wait', late: 'warn', overdue: 'bad' });
});

test('badge text: Arabic digits, the noun agrees with the number, hours until 48 then days', () => {
  const cases: [number, string][] = [
    [0, 'أقل من دقيقة'],
    [59_999, 'أقل من دقيقة'],
    [MIN, 'دقيقة واحدة'],
    [2 * MIN, 'دقيقتين'],
    [3 * MIN, '٣ دقائق'],
    [59 * MIN, '٥٩ دقيقة'],
    [HOUR, 'ساعة واحدة'],
    [2 * HOUR, 'ساعتين'],
    [3 * HOUR + 59 * MIN, '٣ ساعات'],
    [23 * HOUR + 59 * MIN, '٢٣ ساعة'],
    [24 * HOUR, '٢٤ ساعة'],
    [47 * HOUR + 59 * MIN, '٤٧ ساعة'],
    [48 * HOUR, 'يومين'],
    [71 * HOUR, 'يومين'],
    [72 * HOUR, '٣ أيام'],
    [11 * 24 * HOUR, '١١ يوماً'],
  ];
  for (const [ms, text] of cases) assert.equal(waitedText(ago(ms), NOW), text, `${ms} ms`);
  assert.equal(waitBadgeText(ago(3 * HOUR), NOW), 'ينتظر ٣ ساعات');
  assert.equal(waitedText(new Date(NOW.getTime() + HOUR), NOW), 'أقل من دقيقة');
});

test('admin home summary: «N طلب ينتظر، أقدمها منذ …» with the right number agreement', () => {
  assert.equal(pendingSummary(0, null, NOW), 'لا طلبات بانتظار المراجعة');
  assert.equal(pendingSummary(1, ago(3 * HOUR), NOW), 'طلب واحد ينتظر منذ ٣ ساعات');
  assert.equal(pendingSummary(2, ago(30 * HOUR), NOW), 'طلبان ينتظران، أقدمهما منذ ٣٠ ساعة');
  assert.equal(pendingSummary(3, ago(50 * HOUR), NOW), '٣ طلبات تنتظر، أقدمها منذ يومين');
  assert.equal(pendingSummary(10, ago(5 * MIN), NOW), '١٠ طلبات تنتظر، أقدمها منذ ٥ دقائق');
  assert.equal(pendingSummary(11, ago(HOUR), NOW), '١١ طلباً ينتظر، أقدمها منذ ساعة واحدة');
});

// ---------------------------------------------------------------- view from the address

test('the list view is read from the address; anything unknown falls back to the defaults', () => {
  assert.deepEqual(parseQueueView({}), { status: 'pending', courseId: null, sort: 'oldest' });
  assert.deepEqual(parseQueueView({ status: 'accepted' }), { status: 'accepted', courseId: null, sort: 'newest' });
  assert.deepEqual(parseQueueView({ status: 'rejected', course: '7', sort: 'oldest' }), { status: 'rejected', courseId: 7, sort: 'oldest' });
  assert.deepEqual(parseQueueView({ status: 'deleted', course: '7 or 1=1', sort: 'random' }), { status: 'pending', courseId: null, sort: 'oldest' });
  assert.deepEqual(parseQueueView({ status: ['accepted', 'rejected'], course: ['1', '2'], sort: '' }), { status: 'pending', courseId: null, sort: 'oldest' });
  assert.equal(parseQueueView({ course: '0' }).courseId, null);
  assert.equal(parseQueueView({ course: '1234567890123456' }).courseId, null);
  assert.equal(defaultSort('pending'), 'oldest');
  assert.equal(defaultSort('accepted'), 'newest');
});

test('links keep the course filter and leave defaults out', () => {
  assert.equal(queueHref({ status: 'pending', courseId: null, sort: 'oldest' }), '/admin?status=pending');
  assert.equal(queueHref({ status: 'accepted', courseId: null, sort: 'newest' }), '/admin?status=accepted');
  assert.equal(queueHref({ status: 'pending', courseId: 4, sort: 'newest' }, { id: 12 }), '/admin?status=pending&course=4&sort=newest&id=12');
  for (const view of [parseQueueView({ status: 'rejected', course: '9', sort: 'oldest' }), parseQueueView({ course: '3' })]) {
    const back = parseQueueView(Object.fromEntries(new URL(queueHref(view), 'http://x').searchParams));
    assert.deepEqual(back, view);
  }
});

// ---------------------------------------------------------------- database: sorting, filters, counts

const YEAR = new Date().getFullYear();
let db: Db;
let adminId: number;
let tajweed: number;
let nagham: number;
let quiet: number;
const ids: Record<string, number> = {};

async function request(key: string, courseId: number, hoursAgo: number, phone: string) {
  const r = await register(db, {
    fullName: `طالب ${key}`, birthYear: String(YEAR - 25), phone, password: 'password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courseId), answers: {},
  });
  assert.ok(r.ok, JSON.stringify(r));
  const [row] = await db.query<{ id: string }>(`update registrations set created_at = now() - make_interval(secs => $2) where student_id = $1 returning id`, [r.studentId, hoursAgo * 3600]);
  ids[key] = Number(row.id);
}

before(async () => {
  db = await resetDbForTests();
  adminId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'queue@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  const course = async (name: string, open: boolean) =>
    Number((await db.query<{ id: string }>(`insert into courses (name, teacher, published, status) values ($1, 'أستاذ تجريبي', $2, 'open') returning id`, [name, open]))[0].id);
  tajweed = await course('دورة تجويد تجريبية', true);
  nagham = await course('دورة نغم تجريبية', true);
  quiet = await course('دورة بلا طلبات', true);
  await course('دورة مغلقة بلا طلبات', false);
  // Inserted out of order on purpose: the list must not depend on insertion order.
  await request('t-3h', tajweed, 3, '07700000201');
  await request('n-50h', nagham, 50, '07700000202');
  await request('t-30h', tajweed, 30, '07700000203');
  await request('n-10m', nagham, 10 / 60, '07700000204');
  await request('t-72h', tajweed, 72, '07700000205');
  await request('t-decided', tajweed, 100, '07700000206');
  await request('n-decided', nagham, 5, '07700000207');
  assert.equal(await reviewRequest(db, adminId, ids['t-decided'], 'accepted', ''), 'saved');
  assert.equal(await reviewRequest(db, adminId, ids['n-decided'], 'rejected', ''), 'saved');
});
after(async () => {
  await db.close();
});

const keys = (rows: { id: number }[]) => rows.map((r) => Object.keys(ids).find((k) => ids[k] === r.id));

test('pending requests come oldest first by default; «الأحدث أولاً» reverses them', async () => {
  assert.deepEqual(keys(await listRequests(db, 'pending')), ['t-72h', 'n-50h', 't-30h', 't-3h', 'n-10m']);
  assert.deepEqual(keys(await listRequests(db, 'pending', { sort: 'newest' })), ['n-10m', 't-3h', 't-30h', 'n-50h', 't-72h']);
});

test('requests sent in the same instant keep a stable order (by id)', async () => {
  await db.query(`update registrations set created_at = (select created_at from registrations where id = $1) where id = $2`, [ids['t-30h'], ids['t-3h']]);
  try {
    const order = keys(await listRequests(db, 'pending'));
    const [first, second] = [ids['t-30h'], ids['t-3h']].sort((a, b) => a - b).map((id) => Object.keys(ids).find((k) => ids[k] === id));
    assert.deepEqual(order, ['t-72h', 'n-50h', first, second, 'n-10m']);
  } finally {
    await db.query(`update registrations set created_at = now() - interval '3 hours' where id = $1`, [ids['t-3h']]);
  }
});

test('decided lists keep newest first by default and never show pending requests', async () => {
  assert.deepEqual(keys(await listRequests(db, 'accepted')), ['t-decided']);
  assert.deepEqual(keys(await listRequests(db, 'rejected')), ['n-decided']);
  assert.ok((await listRequests(db, 'pending')).every((r) => r.status === 'pending'));
});

test('the course filter narrows the list and the per-status counts', async () => {
  assert.deepEqual(keys(await listRequests(db, 'pending', { courseId: tajweed })), ['t-72h', 't-30h', 't-3h']);
  assert.deepEqual(keys(await listRequests(db, 'pending', { courseId: nagham })), ['n-50h', 'n-10m']);
  assert.deepEqual(keys(await listRequests(db, 'accepted', { courseId: nagham })), []);
  assert.deepEqual(await listRequests(db, 'pending', { courseId: quiet }), []);
  assert.deepEqual(await listRequests(db, 'pending', { courseId: 999999 }), []);
  assert.deepEqual(await countRequests(db), { pending: 5, accepted: 1, rejected: 1 });
  assert.deepEqual(await countRequests(db, tajweed), { pending: 3, accepted: 1, rejected: 0 });
  assert.deepEqual(await countRequests(db, nagham), { pending: 2, accepted: 0, rejected: 1 });
});

test('the course filter lists courses with requests or open registration, busiest first, with their waiting count', async () => {
  const options = await listCourseFilterOptions(db);
  assert.deepEqual(
    options.map((o) => [o.name, o.pending]),
    [['دورة تجويد تجريبية', 3], ['دورة نغم تجريبية', 2], ['دورة بلا طلبات', 0]]
  );
});

test('the admin home names the oldest waiting request of any course, and the badges match the list', async () => {
  const oldest = await oldestPendingAt(db);
  assert.ok(oldest);
  const now = new Date();
  assert.equal(pendingSummary((await countRequests(db)).pending, oldest, now), '٥ طلبات تنتظر، أقدمها منذ ٣ أيام');
  const levels = (await listRequests(db, 'pending')).map((r) => waitLevel(r.createdAt, now));
  assert.deepEqual(levels, ['overdue', 'overdue', 'late', 'fresh', 'fresh']);
  // Once the oldest two are answered, the summary moves to the next one.
  await reviewRequest(db, adminId, ids['t-72h'], 'accepted', '');
  await reviewRequest(db, adminId, ids['n-50h'], 'rejected', '');
  assert.equal(pendingSummary((await countRequests(db)).pending, await oldestPendingAt(db), now), '٣ طلبات تنتظر، أقدمها منذ ٣٠ ساعة');
});

test('no requests waiting: no oldest date, the plain sentence', async () => {
  const fresh = await resetDbForTests();
  try {
    assert.equal(await oldestPendingAt(fresh), null);
    assert.equal(pendingSummary(0, null, new Date()), 'لا طلبات بانتظار المراجعة');
    assert.deepEqual(await listCourseFilterOptions(fresh), []);
  } finally {
    db = await resetDbForTests(); // the shared test database is replaced; re-create what after() closes
  }
});

// ---------------------------------------------------------------- permissions: admins only

const read = (path: string) => readFileSync(path, 'utf8');

test('the requests page checks the admin session before it reads any request', () => {
  const src = read('app/admin/page.tsx');
  const body = src.slice(src.indexOf('async function Requests('));
  const guard = body.indexOf('await requireAdmin()');
  assert.ok(guard > 0, 'Requests() must call requireAdmin()');
  for (const call of ['getDb(', 'listRequests(', 'countRequests(', 'oldestPendingAt(', 'listCourseFilterOptions(', 'getRequest(']) {
    const at = body.indexOf(call);
    assert.ok(at > guard, `${call} must come after requireAdmin()`);
  }
});

test('the review action checks the admin session first, and keeps only a numeric course filter', () => {
  const src = read('app/admin/actions.ts');
  const body = src.slice(src.indexOf('export async function reviewAction('), src.indexOf('export async function notifiedAction('));
  assert.ok(body.indexOf('await requireAdmin()') > 0 && body.indexOf('await requireAdmin()') < body.indexOf('reviewRequest('));
  assert.match(body, /\/\^\\d\{1,15\}\$\/\.test\(text\(form, 'course'\)\)/);
});

test('the queue data is read only by signed-in admin pages (no student page, sign-in page or component)', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p.replace(/\\/g, '/'));
    }
  };
  walk('app');
  walk('components');
  const uses = (f: string, names: RegExp) => names.test(read(f));
  const users = files.filter((f) => uses(f, /\b(listRequests|countRequests|oldestPendingAt|listCourseFilterOptions)\b/));
  assert.ok(users.includes('app/admin/page.tsx'));
  for (const f of users) {
    assert.ok(f.startsWith('app/admin/') && f.endsWith('page.tsx') && !/^app\/admin\/(login|invite)\//.test(f), `${f} reads the queue`);
    assert.match(read(f), /await require(Super)?Admin\(\)/, `${f} must check the admin session`);
  }
  // The new list helpers belong to the requests page (the other admin pages only use countRequests for the menu badge).
  assert.deepEqual(users.filter((f) => uses(f, /\b(listRequests|oldestPendingAt|listCourseFilterOptions)\b/)), ['app/admin/page.tsx']);
});
