import { CONTACT, COURSES } from '@/lib/data';

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

export const COURSES_LD = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'دورات مدرسة نور الأوصياء',
  itemListElement: COURSES.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Course',
      name: c.name,
      provider: ORGANIZATION,
      inLanguage: 'ar',
      ...(c.kindLabel ? { description: c.kindLabel } : {}),
    },
  })),
};
