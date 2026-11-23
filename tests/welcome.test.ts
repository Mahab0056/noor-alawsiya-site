// «أهلاً بيك بالدورة»: flag, six sections with marked gaps, the WhatsApp text, and who may open the page. Invented data only; nothing is sent.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { createAdmin } from '@/lib/accounts';
import { reviewRequest } from '@/lib/admin';
import { resetDbForTests, type Db } from '@/lib/db';
import { courseSlug } from '@/lib/share';
import { register } from '@/lib/registration';
import { decisionMessage } from '@/lib/whatsapp';
import { acceptedWelcomeCourse } from '@/lib/welcome-data';
import { GAP_LABEL, WELCOME_MESSAGE_MAX, welcomeEnabled, welcomeGaps, welcomeMessage, welcomePath, welcomeSections } from '@/lib/welcome';
import { FACT_QUESTIONS, WELCOME_FACTS, type WelcomeFacts } from '@/lib/welcome-config';

const YEAR = new Date().getFullYear();
const ORIGIN = 'https://noor-alawsiya.com';
const NAME = 'دورة السيدة نرجس (ع)';
const SLUG = courseSlug({ name: NAME })!;

test('the flag is off unless it is exactly 1 or true', () => {
  for (const v of [undefined, '', '0', 'false', 'off', 'yes', '2', ' ']) assert.equal(welcomeEnabled({ WELCOME_PAGE: v }), false, String(v));
  for (const v of ['1', 'true', 'TRUE', ' 1 ']) assert.equal(welcomeEnabled({ WELCOME_PAGE: v }), true, v);
  assert.equal(welcomeEnabled({}), false);
});

test('six sections in the briefed order; every missing school fact is a marked gap, never an invented value', () => {
  const s = welcomeSections(null);
  assert.deepEqual(s.map((x) => x.title), ['موعد ومكان', 'شتجيب وياك', 'الآداب', 'الدروس أونلاين', 'الحضور والغياب', 'تتواصل ويا منو']);
  const gaps = s.flatMap((x) => x.items).filter((i) => i.gap);
  assert.ok(gaps.length >= 6);
  for (const g of gaps) assert.ok(g.text.includes(GAP_LABEL));
  assert.ok(s[0].items[1].gap, 'a course without a place shows the place as a gap');
  assert.ok(!welcomeSections('جامع تجريبي')[0].items[1].gap, 'a place from the course record is shown');
  assert.ok(welcomeSections('جامع تجريبي')[0].items[1].text.includes('جامع تجريبي'));
});

test('a filled fact replaces its gap; the gap list follows the config', () => {
  assert.equal(welcomeGaps().length, Object.keys(WELCOME_FACTS).length, 'today every fact is missing');
  assert.deepEqual(welcomeGaps().map((g) => g.key).sort(), Object.keys(FACT_QUESTIONS).sort());
  const full: WelcomeFacts = { time: 'اليوم س', placeFallback: 'م', bring: ['أ', 'ب'], dress: 'ل', lessonsLink: 'ر', absence: 'غ', contactPerson: 'ش' };
  assert.deepEqual(welcomeGaps(full), []);
  assert.equal(welcomeSections(null, full).flatMap((x) => x.items).filter((i) => i.gap).length, 0);
});

test('copy makes no promise of results or certificates', () => {
  const text = JSON.stringify(welcomeSections(null)) + welcomeMessage(NAME, ORIGIN, SLUG);
  assert.doesNotMatch(text, /شهادة|إجازة|ضمان|نضمن|حفظ القرآن|ستحفظ|خلال \d|ستتقن/);
});

test('the WhatsApp text: ≤ 600 characters, welcome link, no gap wording, no phone, no password', () => {
  const m = welcomeMessage(NAME, ORIGIN, SLUG);
  assert.ok(m.length <= WELCOME_MESSAGE_MAX, `${m.length} chars`);
  assert.match(m, /^السلام عليكم/);
  assert.match(m, /«دورة السيدة نرجس \(ع\)»/);
  assert.ok(m.endsWith(`${ORIGIN}${welcomePath(SLUG)}`));
  assert.ok(!m.includes(GAP_LABEL));
  assert.doesNotMatch(m, /\d{6,}/);
  assert.doesNotMatch(m, /كلمة (ال)?(سر|مرور)/);
  // With every fact known and a long place, it still fits.
  const full: WelcomeFacts = { ...WELCOME_FACTS, time: 'السبت والثلاثاء بعد صلاة العصر', placeFallback: null };
  const long = welcomeMessage('دورة قطيع الكفين (ع) النغمية الثانية', ORIGIN, SLUG, 'حسينية أئمة البقيع (ع)، البلديات، شارع الشريط', full);
  assert.ok(long.length <= WELCOME_MESSAGE_MAX, `${long.length} chars`);
  assert.match(long, /الموعد: السبت/);
  assert.match(long, /المكان: حسينية/);
});

test('flag off: the accept message is exactly the old one (decisionMessage is untouched)', () => {
  assert.equal(
    decisionMessage('accepted', NAME, ORIGIN),
    ['السلام عليكم ورحمة الله وبركاته،', `من مدرسة نور الأوصياء للدراسات القرآنية: يسرّنا إبلاغكم بقبول طلب التسجيل في «${NAME}». ستتواصل معكم إدارة المدرسة بموعد الحلقة ومكانها.`, `التفاصيل في الحساب على الموقع: ${ORIGIN}/account`].join('\n')
  );
});

test('proxy: with the flag on, no student cookie or an unknown slug is a real 404 before the page streams', () => {
  const was = process.env.WELCOME_PAGE;
  const rewritten = (path: string, cookie?: string) =>
    (proxy(new NextRequest(`http://localhost:8080${path}`, { headers: cookie ? { host: 'noor-alawsiya.com', cookie } : { host: 'noor-alawsiya.com' } })).headers.get('x-middleware-rewrite') ?? '').endsWith('/welcome-is-off');
  try {
    process.env.WELCOME_PAGE = '1';
    assert.ok(rewritten(welcomePath(SLUG)), 'guest');
    assert.ok(rewritten(welcomePath(SLUG), 'noor_a=x'), 'an admin cookie is not a student');
    assert.ok(rewritten('/welcome/no-such-course', 'noor_s=x'), 'unknown slug, signed in');
    // '/welcome' alone has no page, so Next answers it with a real 404 without the proxy.
    assert.ok(!rewritten(welcomePath(SLUG), 'noor_s=x'), 'a student cookie reaches the page, which checks the session and the course');
    delete process.env.WELCOME_PAGE;
    assert.ok(rewritten(welcomePath(SLUG), 'noor_s=x'), 'flag off: 404 for everyone');
  } finally {
    if (was === undefined) delete process.env.WELCOME_PAGE;
    else process.env.WELCOME_PAGE = was;
  }
});

// ---------------------------------------------------------------- who may open it, on PGlite

let db: Db;
let adminId: number;
const students: Record<'accepted' | 'pending' | 'rejected' | 'other', number> = { accepted: 0, pending: 0, rejected: 0, other: 0 };

async function enrol(tag: string, phone: string, courseId: number) {
  const r = await register(db, { fullName: `طالب ${tag}`, birthYear: String(YEAR - 25), phone, password: 'password-1', guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courseId), answers: {} });
  assert.ok(r.ok, JSON.stringify(r));
  const [row] = await db.query<{ id: string }>('select id from registrations where student_id = $1', [r.studentId]);
  return { studentId: r.studentId, requestId: Number(row.id) };
}

before(async () => {
  db = await resetDbForTests();
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ($1, 'tajweed', 'أستاذ تجريبي', true) returning id`, [NAME]);
  const [d] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة سكينة بنت الإمام الحسين (ع)', 'tahqiq', 'أستاذ تجريبي', true) returning id`);
  adminId = (await createAdmin(db, { name: 'مدير تجريبي', email: 'welcome@example.test', password: 'a-long-test-password', role: 'owner' })).adminId;
  const a = await enrol('أ', '0770 111 0001', Number(c.id));
  await reviewRequest(db, adminId, a.requestId, 'accepted', '');
  students.accepted = a.studentId;
  students.pending = (await enrol('ب', '0770 111 0002', Number(c.id))).studentId;
  const r = await enrol('ج', '0770 111 0003', Number(c.id));
  await reviewRequest(db, adminId, r.requestId, 'rejected', '');
  students.rejected = r.studentId;
  const o = await enrol('د', '0770 111 0004', Number(d.id));
  await reviewRequest(db, adminId, o.requestId, 'accepted', '');
  students.other = o.studentId;
});
after(async () => {
  await db.close();
});

test('only the accepted student of that course opens the page', async () => {
  const ok = await acceptedWelcomeCourse(db, students.accepted, SLUG);
  assert.equal(ok?.course, NAME);
  assert.equal(await acceptedWelcomeCourse(db, students.pending, SLUG), null, 'pending');
  assert.equal(await acceptedWelcomeCourse(db, students.rejected, SLUG), null, 'rejected');
  assert.equal(await acceptedWelcomeCourse(db, students.other, SLUG), null, 'accepted, but in another course');
  assert.equal(await acceptedWelcomeCourse(db, 999999, SLUG), null, 'unknown student');
  assert.equal(await acceptedWelcomeCourse(db, students.accepted, 'no-such-course'), null, 'unknown slug');
  assert.equal(await acceptedWelcomeCourse(db, students.accepted, "x'; drop table students;--"), null, 'hostile slug');
});

test('after a rejection or a later change of decision the page closes again', async () => {
  const [{ id }] = await db.query<{ id: string }>('select id from registrations where student_id = $1', [students.accepted]);
  await reviewRequest(db, adminId, Number(id), 'rejected', '');
  assert.equal(await acceptedWelcomeCourse(db, students.accepted, SLUG), null);
});
