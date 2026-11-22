/**
 * «روابط الحملات»: the rules for a campaign link, shared by the admin form (live preview in the browser) and the server.
 * No imports, so the client form does not pull anything else into its bundle.
 *
 * A link is the public site address plus `?from=<name>`. The name is the only thing it carries: no id of the visitor,
 * no cookie. db/migrations/0009_campaign_links.sql holds the same rules as table checks.
 */

export const ORIGIN = 'https://noor-alawsiya.com';

export const TARGETS = ['register', 'course', 'home'] as const;
export type CampaignTarget = (typeof TARGETS)[number];
export const isTarget = (v: unknown): v is CampaignTarget => typeof v === 'string' && (TARGETS as readonly string[]).includes(v);

export const TARGET_LABEL: Record<CampaignTarget, string> = { register: 'صفحة التسجيل', course: 'دورة محددة', home: 'الصفحة الرئيسية' };

export const NAME_MIN = 2;
export const NAME_MAX = 20;
/** «٢٠», for the Arabic hint and messages. */
export const NAME_MAX_AR = new Intl.NumberFormat('ar-IQ-u-nu-arab').format(NAME_MAX);
/** Lowercase latin letters and digits, words joined by single hyphens: `masjid-poster`, `ig-bio`, `qr2026`. */
export const NAME_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** The sign-up counters use these two for «unknown source» and «no source» (lane awsiya-funnel-counts). */
export const RESERVED_NAMES: readonly string[] = ['other', 'direct'];

/** Trimmed and lowercased, so «IG-Bio » becomes `ig-bio`. Nothing else is changed: a wrong letter is an error, not silently dropped. */
export const cleanName = (raw: string) => raw.trim().toLowerCase();

/** An Arabic message for a bad name, or undefined when the (cleaned) name is fine. */
export function nameError(name: string): string | undefined {
  if (name === '') return 'اكتب اسماً قصيراً للمصدر.';
  if (name.length > NAME_MAX) return `الاسم أطول من ${NAME_MAX_AR} حرفاً.`;
  if (/[^a-z0-9-]/.test(name)) return 'استعمل حروفاً إنجليزية صغيرة (a-z) وأرقاماً وشرطة (-) فقط، بلا مسافات.';
  if (name.length < NAME_MIN) return 'الاسم قصير جداً: حرفان على الأقل.';
  if (!NAME_SHAPE.test(name)) return 'لا تبدأ الاسم بشرطة ولا تنهِه بها، ولا تكرر الشرطة.';
  if (RESERVED_NAMES.includes(name)) return 'هذا الاسم محجوز لعدّاد التسجيل. اختر اسماً آخر.';
  return undefined;
}

/**
 * The link as it is printed and put in the QR code. ASCII only (a course is picked by its number, not its Arabic name),
 * so the QR stays small and Instagram keeps the whole link clickable.
 */
export function campaignUrl(target: CampaignTarget, name: string, courseId?: number | null): string {
  const from = `from=${name}`;
  if (target === 'home') return `${ORIGIN}/?${from}`;
  if (target === 'course') return `${ORIGIN}/register?course=${Number(courseId)}&${from}`;
  return `${ORIGIN}/register?${from}`;
}
