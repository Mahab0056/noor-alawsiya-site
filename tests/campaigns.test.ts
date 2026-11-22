// «روابط الحملات» (/admin/campaigns): names, links, QR codes that decode back to the link, super-admin only. Invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { inflateSync } from 'node:zlib';
import jsQR from 'jsqr';
import { createAdmin } from '@/lib/accounts';
import { campaignUrl, cleanName, nameError } from '@/lib/campaign-links';
import { qrMatrix, qrPath, qrPng, qrSide, qrSvg } from '@/lib/campaign-qr';
import { addCampaignLink, CampaignError, getCampaignLink, listCampaignLinks, validateCampaign } from '@/lib/campaigns';
import { resetDbForTests, type Db } from '@/lib/db';
import { pickCourse } from '@/lib/form-rules';

let db: Db;
let superId: number;
let staffId: number;
let ownerId: number;
let openCourse: number;
let closedCourse: number;
let doneCourse: number;

const PASSWORD = 'a-long-test-password';

before(async () => {
  db = await resetDbForTests();
  superId = (await createAdmin(db, { name: 'مدير أعلى تجريبي', email: 'super@example.test', password: PASSWORD, role: 'super_admin' })).adminId;
  staffId = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'staff@example.test', password: PASSWORD, role: 'staff' })).adminId;
  ownerId = (await createAdmin(db, { name: 'مالك تجريبي', email: 'owner@example.test', password: PASSWORD, role: 'owner' })).adminId;
  const course = async (name: string, status: string, published: boolean) =>
    Number((await db.query<{ id: string }>(`insert into courses (name, teacher, status, published) values ($1, 'أستاذ تجريبي', $2, $3) returning id`, [name, status, published]))[0].id);
  openCourse = await course('دورة تجريبية مفتوحة', 'open', true);
  closedCourse = await course('دورة تجريبية مغلقة', 'open', false);
  doneCourse = await course('دورة تجريبية منتهية', 'done', false);
});
after(async () => {
  await db.close();
});

// ---------------------------------------------------------------- names

test('bad source names are refused with an Arabic message', () => {
  const bad = ['', ' ', 'a', '-ig', 'ig-', 'ig--bio', 'ig bio', 'ig_bio', 'ig.bio', 'إنستا', 'ig/bio', 'ig?x=1', 'ig&from=fb', 'ig#x', 'x'.repeat(21), 'other', 'direct', 'Other', 'é-poster', 'ig%20', '<b>', '١٢٣'];
  for (const raw of bad) {
    const msg = nameError(cleanName(raw));
    assert.ok(msg && /[؀-ۿ]/.test(msg), `accepted ${JSON.stringify(raw)}`);
  }
});

test('good names are kept, lowercased and trimmed', () => {
  for (const [raw, want] of [['ig', 'ig'], ['  IG-Bio ', 'ig-bio'], ['masjid-board', 'masjid-board'], ['poster-1', 'poster-1'], ['qr2026', 'qr2026'], ['a'.repeat(20), 'a'.repeat(20)], ['12', '12']]) {
    assert.equal(cleanName(raw), want);
    assert.equal(nameError(cleanName(raw)), undefined, raw);
  }
});

test('validation asks for a page and, for a course link, the course', () => {
  const r1 = validateCampaign({ name: 'ig-bio', target: 'nowhere', courseId: '' });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.deepEqual(Object.keys(r1.errors), ['target']);
  for (const courseId of ['', '0', '-3', '1.5', 'abc', '99999999999999999999']) {
    const r = validateCampaign({ name: 'ig-bio', target: 'course', courseId });
    assert.equal(r.ok, false, courseId);
    if (!r.ok) assert.deepEqual(Object.keys(r.errors), ['course']);
  }
  const ok = validateCampaign({ name: ' Poster-1 ', target: 'register', courseId: '7' });
  assert.deepEqual(ok, { ok: true, value: { name: 'poster-1', target: 'register', courseId: null } });
});

test('links are the public site address with ?from= and nothing else', () => {
  assert.equal(campaignUrl('home', 'ig-bio'), 'https://noor-alawsiya.com/?from=ig-bio');
  assert.equal(campaignUrl('register', 'masjid-board'), 'https://noor-alawsiya.com/register?from=masjid-board');
  assert.equal(campaignUrl('course', 'poster-1', 12), 'https://noor-alawsiya.com/register?course=12&from=poster-1');
  for (const u of [campaignUrl('home', 'a'), campaignUrl('course', 'x'.repeat(20), 123456)]) {
    assert.match(u, /^[\x21-\x7e]+$/, 'ASCII only, no spaces');
    assert.equal(new URL(u).searchParams.get('from'), u.split('from=')[1]);
  }
});

// ---------------------------------------------------------------- database and permissions

test('a super admin makes links; the table keeps only the link, never a visitor', async () => {
  const a = await addCampaignLink(db, superId, { name: 'Masjid-Board', target: 'register', courseId: '' });
  assert.ok(a.ok, JSON.stringify(a));
  const b = await addCampaignLink(db, superId, { name: 'poster-1', target: 'course', courseId: String(openCourse) });
  assert.ok(b.ok, JSON.stringify(b));
  const c = await addCampaignLink(db, superId, { name: 'ig-bio', target: 'home', courseId: String(openCourse) });
  assert.ok(c.ok, JSON.stringify(c));
  if (!a.ok || !b.ok || !c.ok) return;

  const list = await listCampaignLinks(db);
  assert.deepEqual(list.map((l) => [l.name, l.url]), [
    ['ig-bio', 'https://noor-alawsiya.com/?from=ig-bio'],
    ['poster-1', `https://noor-alawsiya.com/register?course=${openCourse}&from=poster-1`],
    ['masjid-board', 'https://noor-alawsiya.com/register?from=masjid-board'],
  ]);
  assert.equal(list[0].courseId, null, 'a home link ignores a course sent with it');
  assert.equal(list[1].courseName, 'دورة تجريبية مفتوحة');
  assert.equal(list[1].courseAccepting, true);
  assert.equal((await getCampaignLink(db, a.id))?.name, 'masjid-board');
  assert.equal(await getCampaignLink(db, 0), null);
  assert.equal(await getCampaignLink(db, 999999), null);

  const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'campaign_links' order by column_name`);
  assert.deepEqual(cols.map((r) => r.column_name), ['course_id', 'created_at', 'id', 'name', 'target']);

  const audit = await db.query<{ admin_id: string; action: string; target: string; detail: unknown }>(`select admin_id, action, target, detail from audit_log where action = 'campaign.added' order by id`);
  assert.deepEqual(audit.map((r) => [Number(r.admin_id), r.target, r.detail]), [
    [superId, `campaign:${a.id}`, null],
    [superId, `campaign:${b.id}`, null],
    [superId, `campaign:${c.id}`, null],
  ]);
});

test('a used name, a finished or unknown course are refused', async () => {
  const dup = await addCampaignLink(db, superId, { name: ' MASJID-BOARD', target: 'home', courseId: '' });
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.match(dup.errors.name ?? '', /مستعمل/);
  const done = await addCampaignLink(db, superId, { name: 'old-course', target: 'course', courseId: String(doneCourse) });
  assert.equal(done.ok, false);
  if (!done.ok) assert.match(done.errors.course ?? '', /منتهية/);
  const missing = await addCampaignLink(db, superId, { name: 'no-course', target: 'course', courseId: '999999' });
  assert.equal(missing.ok, false);
  const closed = await addCampaignLink(db, superId, { name: 'closed-course', target: 'course', courseId: String(closedCourse) });
  assert.ok(closed.ok, 'a closed (not finished) course may get a link before registration opens');
  if (closed.ok) assert.equal((await getCampaignLink(db, closed.id))?.courseAccepting, false);
});

test('staff, the old owner role, a disabled super admin and an unknown id cannot make links', async () => {
  const before = (await listCampaignLinks(db)).length;
  const disabled = (await createAdmin(db, { name: 'مدير موقوف', email: 'stopped@example.test', password: PASSWORD, role: 'super_admin' })).adminId;
  await db.query('update admins set disabled_at = now() where id = $1', [disabled]);
  for (const id of [staffId, ownerId, disabled, 999999]) {
    await assert.rejects(addCampaignLink(db, id, { name: `try-${id}`, target: 'register', courseId: '' }), (e: CampaignError) => e instanceof CampaignError && e.code === 'not-super');
  }
  assert.equal((await listCampaignLinks(db)).length, before);
});

test('the table itself refuses bad names, reserved names and a course link without a course', async () => {
  for (const name of ['A', 'ig bio', '-ig', 'ig--x', 'x'.repeat(21), 'other', 'direct', 'إنستا']) {
    await assert.rejects(db.query(`insert into campaign_links (name, target) values ($1, 'home')`, [name]), /campaign_name|check/, name);
  }
  await assert.rejects(db.query(`insert into campaign_links (name, target) values ('lonely', 'course')`), /campaign_course_target/);
  await assert.rejects(db.query(`insert into campaign_links (name, target, course_id) values ('stray', 'home', $1)`, [openCourse]), /campaign_course_target/);
  await assert.rejects(db.query(`insert into campaign_links (name, target) values ('x1', 'elsewhere')`), /check/);
});

test('page, Server Action, QR download and menu entry are for super admins only', () => {
  // Each server entry point checks the role itself before touching the database (a Server Action and a route are public endpoints).
  for (const file of ['app/admin/campaigns/page.tsx', 'app/admin/campaigns/actions.ts', 'app/admin/campaigns/qr/route.ts']) {
    const src = readFileSync(file, 'utf8');
    const check = src.indexOf('await requireSuperAdmin()');
    assert.ok(check > 0, `${file} does not call requireSuperAdmin`);
    assert.ok(check < src.indexOf('getDb()'), `${file} opens the database before checking the role`);
    assert.ok(!/requireAdmin\(\)/.test(src), `${file} uses requireAdmin (any role)`);
  }
  const shell = readFileSync('components/AdminShell.tsx', 'utf8');
  assert.match(shell, /admin\.role === 'super_admin' \? \(\s*<Link href="\/admin\/campaigns"/);
  // No cookie is set and no outside QR service is used.
  for (const file of ['lib/campaigns.ts', 'lib/campaign-qr.ts', 'lib/campaign-links.ts', 'app/admin/campaigns/qr/route.ts', 'app/admin/campaigns/page.tsx', 'components/CampaignForm.tsx']) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/cookies\(\)|document\.cookie|Set-Cookie/i.test(src), `${file} touches cookies`);
    assert.ok(!/fetch\(|https?:\/\/(?!noor-alawsiya\.com)[a-z]/i.test(src.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), `${file} calls or links an outside address`);
  }
});

test('a course number in ?course= preselects that course on /register', () => {
  // After the merge with register-form-ux the page uses its pickCourse() (lib/form-rules.ts), which takes an id or a name.
  const src = readFileSync('app/register/page.tsx', 'utf8');
  assert.match(src, /pickCourse\(courses, wanted\)/);
  const open = [{ id: 12, name: 'دورة', kind: null, teacher: 'أ', place: null }];
  assert.equal(pickCourse(open, '12'), 12);
  assert.equal(pickCourse(open, '13'), undefined);
});

// ---------------------------------------------------------------- QR codes decode back to the same link (local decoder: jsqr)

/** Reads the 1-bit greyscale PNG that qrPng writes (filter «none» on every row) into RGBA for jsQR. */
function decodePng(buf: Buffer) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  const types: string[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    types.push(type);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      assert.equal(data[8], 1, 'bit depth');
      assert.equal(data[9], 0, 'greyscale');
    }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  assert.deepEqual(types, ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(w / 8);
  assert.equal(raw.length, (rowBytes + 1) * h);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (rowBytes + 1)], 0, 'filter none');
    for (let x = 0; x < w; x++) {
      const white = (raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
      rgba.fill(white ? 255 : 0, (y * w + x) * 4, (y * w + x) * 4 + 3);
      rgba[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { w, h, rgba };
}

/** Rasterises the SVG's single path (M x y h w v1 h-w z runs) at 6 px per module. */
function decodeSvg(svg: string) {
  const side = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
  const d = /<path fill="#000" d="([^"]+)"/.exec(svg)?.[1] ?? '';
  const S = 6;
  const W = side * S;
  const rgba = new Uint8ClampedArray(W * W * 4).fill(255);
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let py = Number(y) * S; py < (Number(y) + 1) * S; py++)
      for (let px = Number(x) * S; px < (Number(x) + Number(run)) * S; px++) rgba.fill(0, (py * W + px) * 4, (py * W + px) * 4 + 3);
  }
  return { w: W, h: W, rgba };
}

const LINKS = [
  campaignUrl('home', 'ig-bio'),
  campaignUrl('register', 'masjid-board'),
  campaignUrl('course', 'poster-1', 12),
  campaignUrl('course', 'a-very-long-name-20c', 9876543),
];

test('the PNG decodes back to the same link, is at least 1024 px and black on white', () => {
  for (const url of LINKS) {
    const png = qrPng(url);
    const { w, h, rgba } = decodePng(png);
    assert.equal(w, h);
    assert.ok(w >= 1024 && w < 1024 + qrSide(qrMatrix(url)), `size ${w}`);
    assert.equal(rgba[0], 255, 'quiet zone is white');
    const got = jsQR(rgba, w, h);
    assert.equal(got?.data, url);
    assert.ok(png.length < 20_000, `PNG is ${png.length} bytes`);
  }
});

test('the SVG decodes back to the same link, and the page preview draws the same modules', () => {
  for (const url of LINKS) {
    const svg = qrSvg(url);
    assert.match(svg, /^<\?xml[^>]+>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(!/<script|href=|on\w+=/i.test(svg), 'nothing active in the SVG');
    const { w, h, rgba } = decodeSvg(svg);
    assert.equal(jsQR(rgba, w, h)?.data, url);
    assert.ok(svg.includes(`d="${qrPath(qrMatrix(url))}"`));
  }
});

test('a different link gives a different code, and non-ASCII text is refused', () => {
  assert.notEqual(qrPath(qrMatrix(LINKS[0])), qrPath(qrMatrix(LINKS[1])));
  assert.throws(() => qrMatrix('https://noor-alawsiya.com/register?course=دورة'), /ASCII/);
  assert.throws(() => qrMatrix(''), /ASCII/);
});
