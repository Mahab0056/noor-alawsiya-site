import { MAX_NAME, normalizePhone, type FieldErrors } from './form-rules';

/**
 * «بلّغوني لما تنفتح دورة»: rules shared by the server and the form in the browser. The server always re-checks.
 * Least data: the guardian's phone is the only required field. No pupil name, no birth date: an optional age band only.
 */

export const ANY_COURSE = 'any';
export const AGE_BANDS = [
  { value: 'under10', label: 'أقل من ١٠ سنوات' },
  { value: '10to14', label: 'من ١٠ إلى ١٤ سنة' },
  { value: '15plus', label: '١٥ سنة فأكثر' },
] as const;
export type AgeBand = (typeof AGE_BANDS)[number]['value'];
export const AGE_BAND_LABEL = Object.fromEntries(AGE_BANDS.map((b) => [b.value, b.label])) as Record<AgeBand, string>;

/** Bump when the consent wording in components/WaitlistForm.tsx or the waitlist part of /privacy changes. */
export const WAITLIST_CONSENT_VERSION = '2026-11-20';

export type WaitlistInput = { phone: string; guardianName: string; courseId: string; ageBand: string; consent: boolean };
export type CleanWaitlist = { phone: string; guardianName: string | null; courseId: number | null; ageBand: AgeBand | null };

export const WAITLIST_ERRORS = {
  phone: 'اكتب رقم موبايل عراقي صحيح، مثل 07701234567.',
  guardianName: 'الاسم طويل أو قصير جداً. تگدر تتركه فارغ.',
  courseId: 'اختر من القائمة.',
  ageBand: 'اختر من القائمة.',
  consent: 'نحتاج موافقتك حتى نحتفظ بالرقم ونبلّغك.',
} as const;

/** `courseIds`: the courses a visitor may wait for (not finished, not taking registrations). */
export function validateWaitlist(input: WaitlistInput, courseIds: number[]): { ok: true; value: CleanWaitlist } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const phone = normalizePhone(input.phone);
  if (!phone) errors.phone = WAITLIST_ERRORS.phone;

  const name = input.guardianName.trim().replace(/\s+/g, ' ');
  if (name && (name.length < 2 || name.length > MAX_NAME)) errors.guardianName = WAITLIST_ERRORS.guardianName;

  let courseId: number | null = null;
  const rawCourse = input.courseId.trim();
  if (rawCourse && rawCourse !== ANY_COURSE) {
    const n = /^\d{1,15}$/.test(rawCourse) ? Number(rawCourse) : NaN;
    if (courseIds.includes(n)) courseId = n;
    else errors.courseId = WAITLIST_ERRORS.courseId;
  }

  let ageBand: AgeBand | null = null;
  if (input.ageBand) {
    const band = AGE_BANDS.find((b) => b.value === input.ageBand);
    if (band) ageBand = band.value;
    else errors.ageBand = WAITLIST_ERRORS.ageBand;
  }

  if (!input.consent) errors.consent = WAITLIST_ERRORS.consent;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { phone: phone!, guardianName: name || null, courseId, ageBand } };
}
