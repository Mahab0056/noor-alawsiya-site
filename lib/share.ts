import type { Metadata } from 'next';
import { COURSES, type Course } from './data';
import { coursePath } from './share-links';

export { cleanFrom, coursePath, courseUrl, ORIGIN, registerHref, shareText, whatsappShareHref } from './share-links';

/**
 * One page per course (/courses/<slug>) with a WhatsApp share button and its own link card.
 * Pure: no database, no cookies, no tracking script. The only tag is `?from=wa` on the shared link,
 * which the sign-up counters read (lane awsiya-funnel-counts); nothing about the person is kept.
 */

export const SCHOOL_NAME = 'نور الأوصياء';
const SCHOOL_FULL = 'مدرسة نور الأوصياء للدراسات القرآنية';

/**
 * Stable ASCII slugs, keyed by the course name in lib/data.ts. ASCII so a shared link stays short and readable
 * inside a WhatsApp message (an Arabic path turns into %D8%AF… there). A new course needs a line here
 * (tests/course-share.test.ts fails until it has one). Never change a slug once shared: old links would break.
 */
const SLUGS: Record<string, string> = {
  'دورة نغمية بالطريقة العراقية': 'nagham-iraqi-2026',
  'دورة السيدة نرجس (ع)': 'narjis-2026',
  'دورة غير مسمّاة في السجل': 'sajjad-baladiyat-2026',
  'دورة سكينة بنت الإمام الحسين (ع)': 'sukaina-2026',
  'دورة قطيع الكفين (ع) النغمية الثانية': 'qatee-alkafayn-nagham-2-2025',
  'دورة الرسول الأكرم محمد (ص)': 'rasool-akram-2025',
  'دورة السيد حسن نصر الله': 'hassan-nasrallah-2025',
  'دورة فاطمة الزهراء (ع)': 'fatima-zahraa-2024',
  'دورة أئمة البقيع (ع)': 'aimmat-albaqee-2024',
  'دورة الإمام الجواد (ع)': 'imam-jawad-2023',
  'دورة الحسن المجتبى (ع)': 'hasan-mujtaba-2024',
  'دورة الإمام المنتظر (عج)': 'imam-muntadhar-2024',
  'دورة أبي الفضل العباس (ع)': 'abulfadl-abbas-2024',
  'دورة قطيع الكفين (ع)': 'qatee-alkafayn-2023',
  'دورة باب المراد الإمام الجواد (ع)': 'bab-almurad-2023',
  'دورة قطيع الكفين (ع) النغمية الأولى': 'qatee-alkafayn-nagham-1-2022',
  'دورة الصديقة الكبرى (ع)': 'siddiqa-kubra-2021',
  'دورة خاتم المرسلين (ص)': 'khatam-almursaleen-2021',
  'دورة زين العابدين (ع)': 'zain-alabideen-2021',
  'دورة بقية الله (عج)': 'baqiyyat-allah',
};

export function courseSlug(course: Pick<Course, 'name'>): string | undefined {
  return SLUGS[course.name];
}

export function courseBySlug(slug: string): Course | undefined {
  return COURSES.find((c) => SLUGS[c.name] === slug);
}

/** Courses that have a page (every course in the record, as long as SLUGS is complete). */
export const COURSE_PAGES = COURSES.flatMap((c) => {
  const slug = SLUGS[c.name];
  return slug ? [{ slug, course: c }] : [];
});

/** One line for the description: only facts the record has; a missing fact is left out, never guessed. */
export function courseSummary(course: Course): string {
  const parts = [
    course.kindLabel,
    `بإشراف ${course.teacher}`,
    course.place,
    course.start ? `بدأت في ${course.start}` : null,
    course.status === 'done' ? (course.note ?? 'تخرّجت') : null,
  ].filter(Boolean);
  return `${parts.join('، ')}. ${SCHOOL_FULL}، بغداد.`;
}

export const ogImagePath = (slug: string) => `${coursePath(slug)}/og.png`;

/**
 * Per-course tags. `openGraph` and `twitter` are written whole, because a page's object replaces the layout's.
 * A course whose page says «تخرّجت» gets `noindex` (still `follow`): the link and its card keep working when shared,
 * but search does not offer a finished course to parents looking for one to join.
 */
export function courseMetadata(course: Course, slug: string): Metadata {
  const title = course.name;
  const description = courseSummary(course);
  const url = coursePath(slug);
  const image = { url: ogImagePath(slug), width: 1200, height: 630, alt: `${course.name}، ${SCHOOL_FULL}` };
  return {
    title,
    description,
    alternates: { canonical: url },
    ...(course.status === 'done' ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: 'website',
      locale: 'ar_IQ',
      siteName: SCHOOL_FULL,
      title: `${title} | ${SCHOOL_NAME}`,
      description,
      url,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: `${title} | ${SCHOOL_NAME}`, description, images: [image.url] },
  };
}
