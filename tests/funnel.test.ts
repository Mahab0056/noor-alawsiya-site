// Sign-up counters (FUNNEL_COUNTS): sources, Baghdad days, the per-address limit, `saved` inside the registration
// transaction, and the per-link numbers for «روابط الحملات». Invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { createAdmin } from '@/lib/accounts';
import { addCampaignLink } from '@/lib/campaigns';
import { migrate, resetDbForTests, type Db } from '@/lib/db';
import {
  allowCount,
  baghdadDay,
  countBrowserStep,
  countLimitKeysForTests,
  countsByLink,
  countStep,
  countStepInTx,
  funnelOn,
  funnelSummary,
  lastDays,
  normalizeSource,
  PER_ADDRESS_PER_HOUR,
  resetCountLimitsForTests,
  sourceShape,
} from '@/lib/funnel';
import { register, type RegistrationInput } from '@/lib/registration';

let db: Db;
let courseId: number;
const YEAR = new Date().getFullYear();

before(async () => {
  db = await resetDbForTests();
  const superId = (await createAdmin(db, { name: 'مدير أعلى تجريبي', email: 'super@example.test', password: 'a-long-test-password', role: 'super_admin' })).adminId;
  for (const name of ['masjid-board', 'ig-bio', 'poster-2']) {
    const r = await addCampaignLink(db, superId, { name, target: 'register', courseId: '' });
    assert.ok(r.ok, name);
  }
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة تجريبية', 'tajweed', 'أستاذ تجريبي', true) returning id`);
  courseId = Number(c.id);
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query('delete from funnel_daily');
  resetCountLimitsForTests();
});

const rows = (step?: string) =>
  db.query<{ day: string; step: string; source: string; n: number }>(
    `select to_char(day, 'YYYY-MM-DD') as day, step, source, n from funnel_daily ${step ? 'where step = $1' : ''} order by day, step, source`,
    step ? [step] : []
  );
const total = async (step: string) => (await rows(step)).reduce((a, r) => a + Number(r.n), 0);

let phoneN = 0;
const input = (over: Partial<RegistrationInput> = {}): RegistrationInput => {
  phoneN += 1;
  return {
    fullName: `طالب العداد ${phoneN}`, birthYear: String(YEAR - 25), phone: `0770${String(1000000 + phoneN).slice(-7)}`, password: 'password-1',
    guardianName: '', guardianPhone: '', guardianConsent: false, courseId: String(courseId), answers: {},
    ...over,
  };
};

// ---------------------------------------------------------------- flag

test('FUNNEL_COUNTS is off unless set to 1, true or on', () => {
  assert.equal(funnelOn({}), false);
  assert.equal(funnelOn({ FUNNEL_COUNTS: '' }), false);
  assert.equal(funnelOn({ FUNNEL_COUNTS: '0' }), false);
  assert.equal(funnelOn({ FUNNEL_COUNTS: 'off' }), false);
  assert.equal(funnelOn({ FUNNEL_COUNTS: 'yes please' }), false);
  for (const v of ['1', 'true', 'on', ' ON ', 'True']) assert.equal(funnelOn({ FUNNEL_COUNTS: v }), true, v);
});

const open = async () => db;
const at = (address: string) => async () => address;
const ON = { FUNNEL_COUNTS: '1' };

test('with the flag off the browser step writes nothing', async () => {
  assert.equal(await countBrowserStep(open, at('203.0.113.1'), 'view', 'masjid-board', {}), false);
  assert.equal(await countBrowserStep(open, at('203.0.113.1'), 'start', undefined, { FUNNEL_COUNTS: '0' }), false);
  assert.equal((await rows()).length, 0);
});

test('with the flag on the browser step counts view, start and review only, and never throws', async () => {
  assert.ok(await countBrowserStep(open, at('203.0.113.1'), 'view', 'Masjid-Board', ON));
  assert.ok(await countBrowserStep(open, at('203.0.113.1'), 'start', undefined, ON));
  assert.ok(await countBrowserStep(open, at('203.0.113.1'), 'review', 'made-up', ON));
  // `sent` and `saved` come from the server only; a forged browser call cannot move them.
  assert.equal(await countBrowserStep(open, at('203.0.113.1'), 'saved', 'masjid-board', ON), false);
  assert.equal(await countBrowserStep(open, at('203.0.113.1'), 'sent', 'masjid-board', ON), false);
  assert.equal(await countBrowserStep(open, at('203.0.113.1'), { step: 'view' }, ['a'], ON), false);
  // No request around it (headers() throws), or the database is down: false, not an error.
  assert.equal(await countBrowserStep(open, () => Promise.reject(new Error('no request')), 'view', 'x', ON), false);
  assert.equal(await countBrowserStep(() => Promise.reject(new Error('down')), at('203.0.113.1'), 'view', 'x', ON), false);
  assert.deepEqual((await rows()).map((r) => [r.step, r.source, Number(r.n)]), [['review', 'other', 1], ['start', 'direct', 1], ['view', 'masjid-board', 1]]);
});

test('the browser step stops at the per-address limit', async () => {
  for (let i = 0; i < PER_ADDRESS_PER_HOUR + 5; i++) await countBrowserStep(open, at('198.51.100.9'), 'view', 'ig-bio', ON);
  assert.equal(await total('view'), PER_ADDRESS_PER_HOUR);
  assert.ok(await countBrowserStep(open, at('198.51.100.10'), 'view', 'ig-bio', ON));
});

// ---------------------------------------------------------------- sources

test('normalizeSource keeps only names of our own links', async () => {
  assert.equal(await normalizeSource(db, 'masjid-board'), 'masjid-board'); // a known link
  assert.equal(await normalizeSource(db, 'Masjid-Board'), 'masjid-board'); // uppercase, as some apps change it
  assert.equal(await normalizeSource(db, '  ig-bio '), 'ig-bio');
  assert.equal(await normalizeSource(db, 'unknown-poster'), 'other'); // well shaped but not a link of ours
  assert.equal(await normalizeSource(db, 'ig'), 'other'); // no built-in list any more: ig counts only once a link named ig exists
  assert.equal(await normalizeSource(db, undefined), 'direct'); // no ?from=
  assert.equal(await normalizeSource(db, null), 'direct');
  assert.equal(await normalizeSource(db, ''), 'direct');
  assert.equal(await normalizeSource(db, '   '), 'direct');
  assert.equal(await normalizeSource(db, ['masjid-board', 'ig-bio']), 'other'); // ?from=a&from=b
  assert.equal(await normalizeSource(db, []), 'direct');
  assert.equal(await normalizeSource(db, 'masjid-board'.repeat(50)), 'other'); // forged long value
  assert.equal(await normalizeSource(db, `masjid-board${' '.repeat(80)}`), 'other');
  assert.equal(await normalizeSource(db, "x'; drop table funnel_daily; --"), 'other');
  assert.equal(await normalizeSource(db, 'مسجد'), 'other');
  assert.equal(await normalizeSource(db, 42), 'other');
  assert.equal(await normalizeSource(db, 'direct'), 'direct'); // the form posts back what the page worked out
  assert.equal(await normalizeSource(db, 'other'), 'other');
  assert.deepEqual(sourceShape('a'), { fixed: 'other' }); // too short for a link name, no lookup
  assert.deepEqual(sourceShape('-ig'), { fixed: 'other' });
  assert.deepEqual(sourceShape('Poster-2'), { name: 'poster-2' });
});

test('normalizeSource falls back to other when the lookup fails', async () => {
  const broken = { query: async () => Promise.reject(new Error('down')) } as unknown as Db;
  assert.equal(await normalizeSource(broken, 'masjid-board'), 'other');
});

// ---------------------------------------------------------------- days and counting

test('Baghdad day boundary: 23:59 and 00:01 (+03) land on two days', async () => {
  assert.equal(baghdadDay(new Date('2026-11-24T23:59:00+03:00')), '2026-11-24');
  assert.equal(baghdadDay(new Date('2026-11-25T00:01:00+03:00')), '2026-11-25');
  assert.equal(baghdadDay(new Date('2026-11-24T21:01:00Z')), '2026-11-25'); // 00:01 Baghdad, still the 24th in UTC
  assert.ok(await countStep(db, 'view', 'masjid-board', new Date('2026-11-24T23:59:00+03:00')));
  assert.ok(await countStep(db, 'view', 'masjid-board', new Date('2026-11-25T00:01:00+03:00')));
  assert.ok(await countStep(db, 'view', 'masjid-board', new Date('2026-11-25T00:02:00+03:00')));
  assert.deepEqual(
    (await rows()).map((r) => [r.day, r.step, r.source, Number(r.n)]),
    [['2026-11-24', 'view', 'masjid-board', 1], ['2026-11-25', 'view', 'masjid-board', 2]]
  );
  assert.deepEqual(lastDays(7, new Date('2026-11-25T00:01:00+03:00')), { from: '2026-11-19', to: '2026-11-25' });
});

test('countStep is one upsert per step and refuses bad input without throwing', async () => {
  for (let i = 0; i < 5; i++) assert.ok(await countStep(db, 'start', 'direct'));
  assert.deepEqual((await rows('start')).map((r) => Number(r.n)), [5]);
  assert.equal(await countStep(db, 'clicked' as never, 'direct'), false);
  assert.equal(await countStep(db, 'view', 'Bad Source'), false);
  assert.equal(await countStep(db, 'view', 'x'.repeat(21)), false);
  const broken = { query: async () => Promise.reject(new Error('down')) } as unknown as Db;
  assert.equal(await countStep(broken, 'view', 'direct'), false);
  // The table itself refuses what countStep would never send.
  await assert.rejects(db.query(`insert into funnel_daily (day, step, source, n) values ('2026-11-24', 'view', 'Not A Name', 1)`), /funnel_source_shape/);
  await assert.rejects(db.query(`insert into funnel_daily (day, step, source, n) values ('2026-11-24', 'clicked', 'direct', 1)`), /funnel_step/);
  await assert.rejects(db.query(`insert into funnel_daily (day, step, source, n) values ('2026-11-24', 'view', 'direct', -1)`), /funnel_n_positive/);
});

test('funnel_daily has only day, step, source and n: nothing about the visitor', async () => {
  const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'funnel_daily' order by ordinal_position`);
  assert.deepEqual(cols.map((c) => c.column_name), ['day', 'step', 'source', 'n']);
});

// ---------------------------------------------------------------- per-address limit

test('the per-address limit stops one connection inflating a step, and holds no address', () => {
  const now = Date.parse('2026-11-24T10:00:00+03:00');
  for (let i = 0; i < PER_ADDRESS_PER_HOUR; i++) assert.ok(allowCount('203.0.113.7', 'view', now + i));
  assert.equal(allowCount('203.0.113.7', 'view', now + 100), false);
  assert.ok(allowCount('203.0.113.8', 'view', now + 100), 'another address is not affected');
  assert.ok(allowCount('203.0.113.7', 'start', now + 100), 'another step is not affected');
  assert.ok(allowCount('203.0.113.7', 'view', now + 60 * 60 * 1000), 'a new hour starts afresh');
  const keys = countLimitKeysForTests().join(' ');
  assert.ok(!keys.includes('203.0.113'), 'the address itself is not kept');
});

// ---------------------------------------------------------------- `saved` in the registration transaction

test('saved is counted with the registration, and not without the flag', async () => {
  const r = await register(db, input(), { funnelSource: 'masjid-board' });
  assert.ok(r.ok);
  assert.deepEqual((await rows('saved')).map((x) => [x.source, Number(x.n)]), [['masjid-board', 1]]);
  const off = await register(db, input()); // FUNNEL_COUNTS off: registerAction passes no source
  assert.ok(off.ok);
  assert.equal(await total('saved'), 1);
  const bad = await register(db, input({ fullName: 'ع' }), { funnelSource: 'masjid-board' }); // invalid: nothing stored
  assert.equal(bad.ok, false);
  assert.equal(await total('saved'), 1);
});

test('saved does not move when the registration transaction rolls back', async () => {
  // A check that fails only at commit, after everything (the count included) has run inside the transaction.
  await db.exec(`
    create function test_fail_commit() returns trigger language plpgsql as $$ begin raise exception 'test rollback'; end $$;
    create constraint trigger test_fail_commit after insert on registrations deferrable initially deferred for each row execute function test_fail_commit();
  `);
  const students = async () => Number((await db.query<{ n: number }>('select count(*) as n from students'))[0].n);
  const before = await students();
  try {
    await assert.rejects(register(db, input(), { funnelSource: 'masjid-board' }), /test rollback/);
  } finally {
    await db.exec('drop trigger test_fail_commit on registrations; drop function test_fail_commit();');
  }
  assert.equal(await total('saved'), 0);
  assert.equal(await students(), before);
  // And countStepInTx inside a transaction that throws afterwards.
  await assert.rejects(db.tx(async (t) => {
    assert.ok(await countStepInTx(t, 'saved', 'ig-bio'));
    throw new Error('later step failed');
  }), /later step failed/);
  assert.equal(await total('saved'), 0);
});

test('a count that fails inside the transaction does not fail the registration', async () => {
  await db.exec(`
    create function test_fail_count() returns trigger language plpgsql as $$ begin raise exception 'count broken'; end $$;
    create trigger test_fail_count before insert or update on funnel_daily for each row execute function test_fail_count();
  `);
  try {
    const r = await register(db, input(), { funnelSource: 'masjid-board' });
    assert.ok(r.ok, 'the registration is stored');
    const [row] = await db.query('select 1 from registrations where id = $1', [r.ok ? r.registrationId : 0]);
    assert.ok(row);
    assert.equal(await countStep(db, 'sent', 'masjid-board'), false); // and outside a transaction it just says no
  } finally {
    await db.exec('drop trigger test_fail_count on funnel_daily; drop function test_fail_count();');
  }
  assert.equal(await total('saved'), 0);
});

test('registerAction counts sent after the registration limit, and saved inside register()', () => {
  const src = readFileSync('app/actions.ts', 'utf8');
  const fn = src.slice(src.indexOf('export async function registerAction'), src.indexOf('export type LoginState'));
  const limit = fn.indexOf('allowRegistration(');
  const sent = fn.indexOf("countStep(db, 'sent'");
  assert.ok(limit > 0 && sent > limit, 'sent is counted only once the limit has let the submission through');
  assert.ok(fn.indexOf('register(db') > sent);
  assert.match(fn, /funnelOn\(\) \? await normalizeSource\(db, form\.get\('from'\)\) : null/);
  assert.match(fn, /\{ funnelSource: source \}/);
  const reg = readFileSync('lib/registration.ts', 'utf8');
  const tx = reg.slice(reg.indexOf('const store = () => db.tx('), reg.indexOf('  try {\n    return await store();'));
  assert.match(tx, /countStepInTx\(t, 'saved', opts\.funnelSource\)/, 'saved is counted on the transaction, not on db');
});

// ---------------------------------------------------------------- reading

test('summary and per-link numbers cover the last 7 Baghdad days', async () => {
  const now = new Date('2026-11-25T00:30:00+03:00');
  const at = (day: string) => new Date(`${day}T12:00:00+03:00`);
  await countStep(db, 'view', 'masjid-board', at('2026-11-18')); // 8 days back: outside
  for (const [step, n] of [['view', 4], ['start', 3], ['review', 2], ['sent', 2], ['saved', 1]] as const) for (let i = 0; i < n; i++) await countStep(db, step, 'masjid-board', at('2026-11-19'));
  await countStep(db, 'view', 'masjid-board', new Date('2026-11-25T00:05:00+03:00'));
  await countStep(db, 'view', 'direct', at('2026-11-24'));
  await countStep(db, 'view', 'other', at('2026-11-24'));
  await countStep(db, 'saved', 'ig-bio', at('2026-11-23'));
  const s = await funnelSummary(db, 7, now);
  assert.equal(s.from, '2026-11-19');
  assert.equal(s.to, '2026-11-25');
  assert.deepEqual(s.totals, { view: 7, start: 3, review: 2, sent: 2, saved: 2 });
  assert.deepEqual(s.sources.map((x) => x.source), ['masjid-board', 'ig-bio', 'direct', 'other']);
  const per = await countsByLink(db, 7, now);
  assert.deepEqual(Object.fromEntries(per), {
    'masjid-board': { view: 5, start: 3, review: 2, sent: 2, saved: 1 },
    'ig-bio': { view: 0, start: 0, review: 0, sent: 0, saved: 1 },
  });
});

// ---------------------------------------------------------------- migration, privacy and flag-off code paths

test('0008 applies on a database already at the base (0013) and leaves an empty table', async () => {
  await db.exec(`drop table funnel_daily; delete from schema_migrations where name = '0008_funnel_daily.sql'`);
  assert.deepEqual(await migrate(db), ['0008_funnel_daily.sql']);
  assert.deepEqual(await migrate(db), []);
  assert.equal((await rows()).length, 0);
});

test('no cookie, no address written, no outside script in the counting code', () => {
  for (const file of ['lib/funnel.ts', 'app/funnel-actions.ts', 'components/FunnelCard.tsx', 'db/migrations/0008_funnel_daily.sql']) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/cookies\(\)|document\.cookie|Set-Cookie|localStorage|sessionStorage/i.test(src), `${file} touches cookies or storage`);
    assert.ok(!/fetch\(|<script|https?:\/\//i.test(src), `${file} calls or links an outside address`);
  }
  const lib = readFileSync('lib/funnel.ts', 'utf8');
  // The only insert is the daily upsert, and the address goes only into the in-memory HMAC.
  assert.deepEqual(lib.match(/insert into \w+/g), ['insert into funnel_daily']);
  assert.match(lib, /insert into funnel_daily \(day, step, source, n\)/);
  const fn = lib.slice(lib.indexOf('export async function countBrowserStep'));
  assert.ok(fn.indexOf('funnelOn(env)') < fn.indexOf('await address()'), 'the flag is checked before the address is read');
  assert.match(fn, /allowCount\(await address\(\), step\)/);
  assert.match(readFileSync('app/funnel-actions.ts', 'utf8'), /await countBrowserStep\(getDb, clientIp, step, from\);/);
});

test('flag off: the form gets no source, /admin no card, the links page keeps its «لاحقاً» line', () => {
  const page = readFileSync('app/register/page.tsx', 'utf8');
  assert.match(page, /const from = funnelOn\(\) \? await normalizeSource\(db, params\.from\) : undefined;/);
  const form = readFileSync('components/RegisterForm.tsx', 'utf8');
  assert.match(form, /from !== undefined \? <input type="hidden" name="from" value=\{from\} \/> : null/);
  assert.match(form, /const report = useFunnelSteps\(from, step\);/);
  const hook = readFileSync('components/useFunnelSteps.ts', 'utf8');
  assert.match(hook, /if \(from === undefined \|\| reported\.current\.has\(s\)\) return;/);
  assert.ok(!/cookie|localStorage|sessionStorage|https?:\/\//i.test(hook));
  const admin = readFileSync('app/admin/page.tsx', 'utf8');
  assert.match(admin, /funnelOn\(\) \? funnelSummary\(db, 7, now\)\.catch\(\(\) => null\) : null/);
  assert.match(admin, /\{funnel \? <FunnelCard /);
  const links = readFileSync('app/admin/campaigns/page.tsx', 'utf8');
  assert.match(links, /counting \? countsByLink\(db, 7\)\.catch\(\(\) => null\) : null/);
  assert.match(links, /\{perLink \? \(\s*<p className="hint fn-links-note">[\s\S]*?\) : \(\s*<p className="cq-todo">/);
});
