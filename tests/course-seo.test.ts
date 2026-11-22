import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { COURSES, type Course } from '../lib/data';
import { courseIsClosed, courseIsListed, courseLd, coursesLd, isoDate, ldJson, ORGANIZATION, SCHOOL_LD, sitemapEntries } from '../lib/seo';
import { COURSE_PAGES, courseBySlug, courseMetadata, courseSummary, ORIGIN } from '../lib/share';
import { checkLd } from './ld-schema';

const without = (o: object, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const page = (slug: string) => ({ slug, course: courseBySlug(slug)! });
const narjis = page('narjis-2026'); // running, every fact known
const unnamed = page('sajjad-baladiyat-2026'); // running, no kind, two teachers
const baqiyya = page('baqiyyat-allah'); // status not given, no start date
const hasan = page('hasan-mujtaba-2024'); // «تخرّجت», no place

test('the metadata builder: a running course is indexable, a course whose page says «تخرّجت» is noindex (still follow)', () => {
  assert.equal(narjis.course.status, 'open');
  assert.equal(courseMetadata(narjis.course, narjis.slug).robots, undefined);
  assert.equal(baqiyya.course.status, 'unknown');
  assert.equal(courseMetadata(baqiyya.course, baqiyya.slug).robots, undefined, 'an unknown status is not «closed»');
  assert.equal(hasan.course.status, 'done');
  assert.deepEqual(courseMetadata(hasan.course, hasan.slug).robots, { index: false, follow: true });
  // The rest of the tags stay, so a shared link to a finished course still gets its card.
  const m = courseMetadata(hasan.course, hasan.slug);
  assert.equal(m.title, hasan.course.name);
  assert.equal(m.alternates?.canonical, `/courses/${hasan.slug}`);
  assert.equal((m.openGraph as { images: { url: string }[] }).images[0].url, `/courses/${hasan.slug}/og.png`);
  for (const { slug, course } of COURSE_PAGES) {
    assert.equal(courseMetadata(course, slug).robots !== undefined, courseIsClosed(course), slug);
    assert.equal(courseIsClosed(course), course.status === 'done', slug);
  }
});

test('the metadata builder with missing facts: the description leaves them out, title and canonical stay', () => {
  const m = courseMetadata(baqiyya.course, baqiyya.slug);
  assert.equal(m.title, 'دورة بقية الله (عج)');
  assert.equal(m.description, courseSummary(baqiyya.course));
  assert.doesNotMatch(String(m.description), /بدأت|null|undefined|غير مذكور/);
  const noKind = courseMetadata(unnamed.course, unnamed.slug);
  assert.ok(String(noKind.description).startsWith('بإشراف '), 'no kind: the line starts with the teachers');
});

test('isoDate turns only a full Arabic date into YYYY-MM-DD; a month or a year alone is not guessed', () => {
  assert.equal(isoDate('٢٦ أيلول ٢٠٢٦'), '2026-09-26');
  assert.equal(isoDate('٣ أيار ٢٠٢٦'), '2026-05-03');
  assert.equal(isoDate('٧ تشرين الأول ٢٠٢٥'), '2025-10-07');
  assert.equal(isoDate('١٥ تشرين الثاني ٢٠٢٤'), '2024-11-15');
  assert.equal(isoDate('١ كانون الأول ٢٠٢٤'), '2024-12-01');
  assert.equal(isoDate('١ شباط ٢٠٢٣'), '2023-02-01');
  assert.equal(isoDate('9 حزيران 2024'), '2024-06-09');
  for (const vague of ['نيسان ٢٠٢٢', '٢٠٢١', '٢٠٢٣', '٣١ شباط ٢٠٢٤', '٣ مايو ٢٠٢٤', '', null]) assert.equal(isoDate(vague), null, String(vague));
  // Every start date in the record is either a full date or left out, never something else.
  for (const c of COURSES) {
    const iso = isoDate(c.start);
    if (iso) assert.match(iso, /^20\d\d-\d\d-\d\d$/, c.name);
  }
});

test('Course data on a course page: only while it takes registrations and the page does not say «تخرّجت»', () => {
  assert.equal(courseLd(narjis.course, narjis.slug, undefined), null, 'running but closed in the panel: no data');
  assert.equal(courseLd(hasan.course, hasan.slug, 7), null, 'a finished course never gets data, even with an id');
  assert.equal(courseIsListed(hasan.course, 7), false);
  assert.equal(courseIsListed(narjis.course, 2), true);
  assert.deepEqual(courseLd(narjis.course, narjis.slug, 2), {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': 'https://noor-alawsiya.com/courses/narjis-2026#course',
    name: 'دورة السيدة نرجس (ع)',
    description: courseSummary(narjis.course),
    url: 'https://noor-alawsiya.com/courses/narjis-2026',
    image: 'https://noor-alawsiya.com/courses/narjis-2026/og.png',
    inLanguage: 'ar',
    teaches: 'أحكام التلاوة والتجويد',
    provider: ORGANIZATION,
    hasCourseInstance: [
      {
        '@type': 'CourseInstance',
        instructor: [{ '@type': 'Person', name: 'الأستاذ علاء' }],
        location: { '@type': 'Place', name: 'جامع الإمام علي (ع)، البلديات', address: { '@type': 'PostalAddress', addressLocality: 'بغداد', addressCountry: 'IQ' } },
        startDate: '2026-05-03',
      },
    ],
  });
});

test('Course data with missing facts: no kind, no place, no full date → those fields are absent, never filled in', () => {
  const ld = courseLd(unnamed.course, unnamed.slug, 3)!;
  assert.equal('teaches' in ld, false, 'the record gives no kind');
  assert.deepEqual(ld.hasCourseInstance[0].instructor, [
    { '@type': 'Person', name: 'الشيخ أبو مصطفى الدراجي' },
    { '@type': 'Person', name: 'الأستاذ يوسف طالب' },
  ]);
  const bare: Course = { ...narjis.course, kind: null, kindLabel: null, place: null, start: 'أيار ٢٠٢٦' };
  const b = courseLd(bare, narjis.slug, 2)!;
  assert.equal('teaches' in b, false);
  assert.deepEqual(Object.keys(b.hasCourseInstance[0]), ['@type', 'instructor']);
  const text = JSON.stringify(b);
  assert.doesNotMatch(text, /null|undefined|غير مذكور|"(offers|price|courseMode|courseSchedule|courseWorkload|audience|typicalAgeRange|educationalLevel)"/);
  const noStart = courseLd({ ...baqiyya.course }, baqiyya.slug, 9)!;
  assert.equal('startDate' in noStart.hasCourseInstance[0], false);
});

test('local schema check: every Course, the /courses list and the school data pass; broken samples are caught', () => {
  for (const { slug, course } of COURSE_PAGES) {
    const ld = courseLd(course, slug, 1);
    if (courseIsClosed(course)) assert.equal(ld, null, slug);
    else assert.deepEqual(checkLd(ld), [], slug);
  }
  assert.deepEqual(checkLd(SCHOOL_LD), []);
  const list = coursesLd([
    { id: 2, name: narjis.course.name, description: narjis.course.kindLabel, teacher: narjis.course.teacher },
    { id: 40, name: 'دورة جديدة من اللوحة', description: null, teacher: 'الأستاذ س' },
  ]);
  assert.deepEqual(checkLd(list), []);
  // The checker itself: each broken sample gives an error.
  const good = courseLd(narjis.course, narjis.slug, 2)!;
  const broken: [string, unknown][] = [
    ['no provider', without(good, 'provider')],
    ['empty description', { ...good, description: '' }],
    ['null', { ...good, teaches: null }],
    ['relative url', { ...good, url: '/courses/narjis-2026' }],
    ['other host', { ...good, image: 'https://example.com/x.png' }],
    ['unknown property', { ...good, offers: { '@type': 'Offer', price: 0 } }],
    ['bad date', { ...good, hasCourseInstance: [{ ...good.hasCourseInstance[0], startDate: '٣ أيار ٢٠٢٦' }] }],
    ['placeholder', { ...good, teaches: 'غير مذكور' }],
    ['no context', without(good, '@context')],
    ['unknown type', { ...good, '@type': 'Event' }],
    ['person without name', { ...good, hasCourseInstance: [{ '@type': 'CourseInstance', instructor: [{ '@type': 'Person' }] }] }],
  ];
  for (const [label, sample] of broken) assert.ok(checkLd(sample).length > 0, label);
});

test('the JSON-LD script text cannot be closed by a course name', () => {
  const evil = courseLd({ ...narjis.course, name: 'x</script><script>alert(1)</script>' }, narjis.slug, 2);
  const html = ldJson(evil);
  assert.doesNotMatch(html, /</);
  assert.equal(JSON.parse(html).name, 'x</script><script>alert(1)</script>');
});

test('the sitemap: public pages always; a course page only while it takes registrations and is not «تخرّجت»', () => {
  const statics = ['/', '/courses', '/register', '/privacy'].map((p) => `${ORIGIN}${p}`);
  assert.deepEqual(sitemapEntries(null).map((e) => e.url), statics, 'database not readable: no course is guessed');
  assert.deepEqual(sitemapEntries({}).map((e) => e.url), statics, 'fresh seed: nothing open');
  const urls = sitemapEntries({ [narjis.course.name]: 2, [unnamed.course.name]: 3, [hasan.course.name]: 11, 'دورة ليست في السجل': 40 }).map((e) => e.url);
  assert.deepEqual(urls, [...statics, `${ORIGIN}/courses/${narjis.slug}`, `${ORIGIN}/courses/${unnamed.slug}`]);
  for (const e of sitemapEntries(Object.fromEntries(COURSES.map((c, i) => [c.name, i + 1])))) {
    assert.deepEqual(Object.keys(e), ['url'], 'no invented lastModified / priority');
    assert.ok(e.url.startsWith(`${ORIGIN}/`));
  }
  const all = sitemapEntries(Object.fromEntries(COURSES.map((c, i) => [c.name, i + 1]))).map((e) => e.url);
  assert.equal(all.length, 4 + COURSES.filter((c) => !courseIsClosed(c)).length);
  assert.equal(new Set(all).size, all.length);
});

test('wiring: the sitemap and the course page read the same database view; the page prints courseLd', () => {
  const sm = readFileSync('app/sitemap.ts', 'utf8');
  assert.match(sm, /await getPublicCourses\(\)/);
  assert.match(sm, /sitemapEntries\(live\?\.openByName \?\? null\)/);
  const pg = readFileSync('app/courses/[slug]/page.tsx', 'utf8');
  assert.match(pg, /const ld = courseLd\(course, slug, openId\);/);
  assert.match(pg, /\{ld \? <JsonLd data=\{ld\} \/> : null\}/);
  // robots.txt still points at the sitemap and keeps the private areas out.
  assert.match(readFileSync('app/robots.ts', 'utf8'), /sitemap: 'https:\/\/noor-alawsiya\.com\/sitemap\.xml'/);
});
