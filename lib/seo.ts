import type { MetadataRoute } from 'next';
import { CONTACT, type Course } from '@/lib/data';
import { COURSE_PAGES, courseSlug, coursePath, courseSummary, ogImagePath } from '@/lib/share';

const ORIGIN = 'https://noor-alawsiya.com';
const NAME = 'مدرسة نور الأوصياء للدراسات القرآنية';

/**
 * Structured data. Only facts the site already shows: the name, the city, the logo and the school's own social pages.
 * No phone, street address or opening dates: the school's record still has open conflicts on those (record-notes).
 */
export const ORGANIZATION = {
  '@type': 'EducationalOrganization',
  '@id': `${ORIGIN}/#school`,
  name: NAME,
  url: `${ORIGIN}/`,
  logo: `${ORIGIN}/img/icon-512.png`,
  image: `${ORIGIN}/img/og.png`,
  description: 'دورات أحكام التلاوة والتجويد، القراءة التحقيقية والإجازة، والنغم القرآني.',
  inLanguage: 'ar',
  address: { '@type': 'PostalAddress', addressLocality: 'بغداد', addressCountry: 'IQ' },
  sameAs: [CONTACT.facebook, CONTACT.instagram, CONTACT.youtube],
};

export const SCHOOL_LD = { '@context': 'https://schema.org', ...ORGANIZATION };

/** JSON for a <script type="application/ld+json">: every `<` becomes the JSON escape \u003c, so no value can close the tag. */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

/**
 * `Course` items only for the courses that take registrations now (published + open in the database). Running courses
 * that do not take new students are left out, so search results never advertise a course nobody can join.
 * Returns null when there is nothing to list (or the database could not be read): the page then prints no course data.
 */
export function coursesLd(open: { id: number; name: string; description: string | null; teacher?: string }[]) {
  if (open.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'دورات مدرسة نور الأوصياء المفتوحة للتسجيل',
    itemListElement: open.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Course',
        name: c.name,
        // The course's own page when it has one (lib/share.ts), else the form with the course chosen.
        url: courseSlug(c) ? `${ORIGIN}${coursePath(courseSlug(c)!)}` : `${ORIGIN}/register?course=${c.id}`,
        provider: ORGANIZATION,
        inLanguage: 'ar',
        // Google's Course data asks for a description: the record's kind, else who teaches it (a fact we have).
        ...(c.description ? { description: c.description } : c.teacher ? { description: `بإشراف ${c.teacher}` } : {}),
      },
    })),
  };
}

/**
 * A course whose page says it is over («تخرّجت»: status 'done' in the record). Its page stays reachable and shareable,
 * but asks search engines not to index it (lib/share.ts courseMetadata), is left out of the sitemap and gets no
 * Course data. A running course and one whose status the record does not give are not «closed».
 */
export const courseIsClosed = (course: Pick<Course, 'status'>) => course.status === 'done';

/** Search may list a course page only when the page does not say «تخرّجت» and the course takes registrations now. */
export const courseIsListed = (course: Pick<Course, 'status'>, openId: number | undefined) => openId !== undefined && !courseIsClosed(course);

const MONTHS: Record<string, number> = {
  'كانون الثاني': 1, 'شباط': 2, 'آذار': 3, 'نيسان': 4, 'أيار': 5, 'حزيران': 6,
  'تموز': 7, 'آب': 8, 'أيلول': 9, 'تشرين الأول': 10, 'تشرين الثاني': 11, 'كانون الأول': 12,
};

/**
 * «٢٦ أيلول ٢٠٢٦» → «2026-09-26». Only a full day + month + year becomes a date: «نيسان ٢٠٢٢» or «٢٠٢١» give null,
 * because a structured date with a guessed day would state something the record does not.
 */
export function isoDate(text: string | null): string | null {
  if (!text) return null;
  const western = text.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\s+/g, ' ');
  const m = /^(\d{1,2}) (.+) (\d{4})$/.exec(western);
  const month = m ? MONTHS[m[2]] : undefined;
  if (!m || !month) return null;
  const [day, year] = [Number(m[1]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // «٣١ شباط»
  return date.toISOString().slice(0, 10);
}

/** The record writes several teachers in one field, separated by «،». */
const teachers = (field: string) => field.split('،').map((t) => t.trim()).filter(Boolean);

/**
 * `Course` data for one course page, or null when search should not list it (see courseIsListed). Only facts the page
 * itself shows: name, the description line, kind, teachers, the place and the start date when the record has them.
 * No price, no schedule, no course mode, no age group: the school has not stated them, so they stay out.
 */
export function courseLd(course: Course, slug: string, openId: number | undefined) {
  if (!courseIsListed(course, openId)) return null;
  const url = `${ORIGIN}${coursePath(slug)}`;
  const startDate = isoDate(course.start);
  const instance = {
    '@type': 'CourseInstance',
    instructor: teachers(course.teacher).map((name) => ({ '@type': 'Person', name })),
    ...(course.place ? { location: { '@type': 'Place', name: course.place, address: { '@type': 'PostalAddress', addressLocality: 'بغداد', addressCountry: 'IQ' } } } : {}),
    ...(startDate ? { startDate } : {}),
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': `${url}#course`,
    name: course.name,
    description: courseSummary(course),
    url,
    image: `${ORIGIN}${ogImagePath(slug)}`,
    inLanguage: 'ar',
    ...(course.kindLabel ? { teaches: course.kindLabel } : {}),
    provider: ORGANIZATION,
    hasCourseInstance: [instance],
  };
}

/**
 * The sitemap: the public pages, plus the page of every course search may list (open in the database, not «تخرّجت»).
 * `openByName` is null when the database cannot be read (and during `next build`): then no course page is listed
 * rather than a guess. No lastModified: the site has no real edit dates to report.
 */
export function sitemapEntries(openByName: Record<string, number> | null): MetadataRoute.Sitemap {
  const courses = COURSE_PAGES.filter(({ course }) => courseIsListed(course, openByName?.[course.name])).map(({ slug }) => coursePath(slug));
  return ['/', '/courses', '/register', '/privacy', ...courses].map((path) => ({ url: `${ORIGIN}${path}` }));
}
