import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sitemap from '../app/sitemap';
import { COURSES } from '../lib/data';
import { shapeArabic, visualWord, visualWords } from '../lib/og-arabic';
import {
  cleanFrom,
  COURSE_PAGES,
  courseBySlug,
  courseMetadata,
  courseSlug,
  courseSummary,
  courseUrl,
  ORIGIN,
  registerHref,
  shareText,
  whatsappShareHref,
} from '../lib/share';

test('every course in the record has one stable ASCII slug, and every slug finds its course', () => {
  assert.equal(COURSE_PAGES.length, COURSES.length);
  const slugs = COURSE_PAGES.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'slugs are unique');
  for (const { slug, course } of COURSE_PAGES) {
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, slug);
    assert.equal(courseBySlug(slug), course);
    assert.equal(courseSlug(course), slug);
  }
  assert.equal(courseBySlug('nope'), undefined);
  assert.equal(courseBySlug('__proto__'), undefined);
  assert.equal(courseBySlug('constructor'), undefined);
});

test('the WhatsApp message is the course, the school and the link tagged ?from=wa, encoded for wa.me', () => {
  const course = courseBySlug('narjis-2026')!;
  assert.equal(course.name, 'دورة السيدة نرجس (ع)');
  const text = shareText(course.name, 'narjis-2026');
  assert.equal(text, 'دورة السيدة نرجس (ع) · مدرسة نور الأوصياء\nhttps://noor-alawsiya.com/courses/narjis-2026?from=wa');
  const href = whatsappShareHref(course.name, 'narjis-2026');
  // wa.me with no number lets the person pick the chat or group. Nothing else in the URL.
  assert.ok(href.startsWith('https://wa.me/?text='), href);
  const url = new URL(href);
  assert.deepEqual([...url.searchParams.keys()], ['text']);
  assert.equal(url.searchParams.get('text'), text);
  // Encoded so WhatsApp gets it whole: no raw space, newline, & or # in the link. Arabic letters stay as they are
  // (2 bytes each instead of 6); the browser percent-encodes them when the link is followed.
  assert.doesNotMatch(href, /[\s&#]/);
  assert.doesNotMatch(href, /%D8|%D9/, 'letters are not percent-encoded in the page');
  assert.equal(new URL(href).href, 'https://wa.me/?text=' + encodeURIComponent(text), 'the followed URL is the fully encoded one');
  assert.match(href, /%0A/, 'the link sits on its own line');
  assert.match(href, /%3Ffrom%3Dwa$/, 'the tag ends the message, so the link is the last thing in it');
});

test('every course gets a message that decodes back to its own name and link', () => {
  for (const { slug, course } of COURSE_PAGES) {
    const text = new URL(whatsappShareHref(course.name, slug)).searchParams.get('text')!;
    assert.ok(text.startsWith(course.name), course.name);
    assert.ok(text.endsWith(`${ORIGIN}/courses/${slug}?from=wa`), slug);
  }
});

test('only a short lowercase word is kept as ?from=, so nothing odd is echoed into a link', () => {
  assert.equal(cleanFrom('wa'), 'wa');
  assert.equal(cleanFrom(' WA '), 'wa');
  assert.equal(cleanFrom('ig'), 'ig');
  // Campaign-link names (lib/campaign-links.ts) pass too, so a poster's source survives from a course page into /register.
  for (const good of ['qr1', 'masjid-board', 'poster-1', 'a'.repeat(20)]) assert.equal(cleanFrom(good), good, good);
  for (const bad of ['', 'w', 'wa&x=1', '<script>', 'واتس', 'a'.repeat(21), 'wa wa', '-wa', 'wa-', 'wa--x', 'wa_x']) assert.equal(cleanFrom(bad), undefined, bad);
  assert.equal(cleanFrom(['wa', 'ig']), undefined);
  assert.equal(cleanFrom(undefined), undefined);
  assert.equal(courseUrl('narjis-2026'), 'https://noor-alawsiya.com/courses/narjis-2026');
  assert.equal(courseUrl('narjis-2026', '<x>'), 'https://noor-alawsiya.com/courses/narjis-2026');
});

test('from=wa survives into /register: «سجّل» keeps the source next to the preselected course', () => {
  const name = 'دورة السيدة نرجس (ع)';
  const withSource = new URL(registerHref(name, 'wa'), ORIGIN);
  assert.equal(withSource.pathname, '/register');
  assert.equal(withSource.searchParams.get('course'), name);
  assert.equal(withSource.searchParams.get('from'), 'wa');
  const plain = new URL(registerHref(name), ORIGIN);
  assert.equal(plain.searchParams.get('course'), name);
  assert.equal(plain.searchParams.has('from'), false);
  assert.equal(new URL(registerHref(name, 'x"><img'), ORIGIN).searchParams.has('from'), false);
  // The course page reads ?from= in the browser and builds the link with this same helper.
  const link = readFileSync('components/CourseRegisterLink.tsx', 'utf8');
  assert.match(link, /useSearchParams\(\)\.get\('from'\)/);
  assert.match(link, /registerHref\(course, from\)/);
  // /register preselects by id or name (pickCourse, after the merge with register-form-ux), so the link lands on the right course.
  assert.match(readFileSync('app/register/page.tsx', 'utf8'), /pickCourse\(courses, wanted\)/);
  assert.equal(new URL(registerHref(42, 'masjid-board'), ORIGIN).search, '?course=42&from=masjid-board');
});

test('a course page offers «سجّل» only for a course open in the database, linked by its id (review fix)', () => {
  const page = readFileSync('app/courses/[slug]/page.tsx', 'utf8');
  assert.match(page, /const live = await getPublicCourses\(\);/);
  assert.match(page, /const openId = live\?\.openByName\[course\.name\];/);
  assert.match(page, /\{openId !== undefined \? \(\s*<Suspense/);
  assert.match(page, /registerHref\(openId\)/);
  assert.match(page, /<CourseRegisterLink course=\{openId\}/);
  assert.doesNotMatch(page, /registerHref\(course\.name\)/);
});

test('each course page has its own og:title, og:description, og:url and card image; the home card is untouched', () => {
  const seen = new Set<string>();
  for (const { slug, course } of COURSE_PAGES) {
    const m = courseMetadata(course, slug);
    const og = m.openGraph as { title: string; description: string; url: string; images: { url: string; width: number; height: number; alt: string }[]; siteName: string; locale: string };
    assert.equal(m.title, course.name);
    assert.equal(og.title, `${course.name} | نور الأوصياء`);
    assert.equal(og.url, `/courses/${slug}`);
    assert.equal(m.alternates?.canonical, `/courses/${slug}`);
    assert.equal(og.description, m.description);
    assert.ok(og.description.includes(course.teacher), slug);
    assert.deepEqual(og.images.map((i) => [i.url, i.width, i.height]), [[`/courses/${slug}/og.png`, 1200, 630]]);
    assert.ok(og.images[0].alt.startsWith(course.name));
    // The page's openGraph replaces the layout's whole object, so the site name and locale are repeated here.
    assert.equal(og.siteName, 'مدرسة نور الأوصياء للدراسات القرآنية');
    assert.equal(og.locale, 'ar_IQ');
    const tw = m.twitter as { card: string; images: string[] };
    assert.equal(tw.card, 'summary_large_image');
    assert.deepEqual(tw.images, [`/courses/${slug}/og.png`]);
    seen.add(og.description);
  }
  assert.equal(seen.size, COURSE_PAGES.length, 'no two courses share a description');
  assert.match(readFileSync('app/layout.tsx', 'utf8'), /images: \[\{ url: '\/img\/og\.png'/);
});

test('the description says only what the record says: a missing fact is left out, not filled in', () => {
  const unnamed = courseBySlug('baqiyyat-allah')!;
  assert.equal(unnamed.start, null);
  const text = courseSummary(unnamed);
  assert.doesNotMatch(text, /بدأت|null|undefined|غير مذكور/);
  assert.equal(text, 'القراءة التحقيقية، بإشراف الأستاذ ضياء اللامي، حسينية أبي الفضل العباس (ع) ثم جامع الإمام السجاد (ع). مدرسة نور الأوصياء للدراسات القرآنية، بغداد.');
  const done = courseBySlug('hasan-mujtaba-2024')!;
  assert.match(courseSummary(done), /تخرّجت في محفل ١٢ أيلول ٢٠٢٥/);
  for (const { course } of COURSE_PAGES) assert.doesNotMatch(courseSummary(course), /null|undefined|،،|، \./, course.name);
});

test('the sitemap lists every course page; the card route and page are static, with no cookie or tracking script', () => {
  const urls = sitemap().map((e) => e.url);
  for (const { slug } of COURSE_PAGES) assert.ok(urls.includes(`${ORIGIN}/courses/${slug}`), slug);
  const route = readFileSync('app/courses/[slug]/og.png/route.tsx', 'utf8');
  assert.match(route, /export function generateStaticParams/);
  assert.match(route, /from 'next\/og'/);
  const page = readFileSync('app/courses/[slug]/page.tsx', 'utf8');
  assert.match(page, /export function generateStaticParams/);
  assert.match(page, /notFound\(\)/);
  for (const src of [page, route, readFileSync('components/ShareCourse.tsx', 'utf8'), readFileSync('lib/share.ts', 'utf8'), readFileSync('lib/share-links.ts', 'utf8')]) {
    assert.doesNotMatch(src, /cookies\(|document\.cookie|localStorage|<script|gtag|fbq|analytics/i);
  }
});

test('the link card pre-shapes Arabic so Satori draws joined letters with exact widths, right to left', () => {
  // د و ر ة: dal and waw never join forward, so dal is isolated, waw isolated, reh isolated, teh marbuta isolated.
  assert.equal(shapeArabic('دورة'), '\uFEA9\uFEED\uFEAD\uFE93');
  // ن ر ج س: noon initial, reh final, jeem initial, seen final.
  assert.equal(shapeArabic('نرجس'), '\uFEE7\uFEAE\uFE9F\uFEB2');
  // lam-alef becomes one ligature; after a joining letter it takes the final form.
  assert.equal(shapeArabic('لا'), '\uFEFB');
  assert.equal(shapeArabic('الآن'), '\uFE8D\uFEF5\uFEE5');
  assert.equal(shapeArabic('بلا'), '\uFE91\uFEFC');
  // shadda and other marks are dropped on the card only.
  assert.equal(shapeArabic('تخرّجت'), shapeArabic('تخرجت'));
  // drawn left to right: letters reversed, brackets mirrored, digits kept in order.
  assert.equal(visualWord('(ع)'), '(\uFEC9)');
  assert.equal(visualWord('٢٠٢٦'), '٢٠٢٦');
  assert.equal(visualWord('(عج)'), '(\uFE9E\uFECB)');
  assert.deepEqual(visualWords('  دورة   نرجس '), [visualWord('دورة'), visualWord('نرجس')]);
  // Every name and teacher in the record comes out as presentation forms, punctuation, digits or spaces only.
  for (const c of COURSES) {
    for (const w of visualWords(`${c.name} ${c.teacher}`)) assert.match(w, /^[\uFE70-\uFEFF()،·٠-٩0-9-]+$/u, `${c.name}: ${w}`);
  }
});
