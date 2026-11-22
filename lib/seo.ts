import { CONTACT } from '@/lib/data';
import { courseSlug, coursePath } from '@/lib/share';

const ORIGIN = 'https://noor-alawsiya.com';
const NAME = 'مدرسة نور الأوصياء للدراسات القرآنية';

/**
 * Structured data. Only facts the site already shows: the name, the city, the logo and the school's own social pages.
 * No phone, street address or opening dates: the school's record still has open conflicts on those (record-notes).
 */
const ORGANIZATION = {
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
