/**
 * Registration rules shared by the server and the registration form in the browser.
 * The server always re-checks; the browser copy only decides what to show.
 */

export type QuestionKind = 'single' | 'multi' | 'yes_no' | 'text';
export type ShowIf = { question_id: number; equals: string } | null;
export type FormQuestion = { id: number; label: string; kind: QuestionKind; options: string[]; required: boolean; position: number; showIf: ShowIf; active: boolean };
export type Answers = Record<string, string | string[] | undefined>;
export type OpenCourse = { id: number; name: string; kind: string | null; teacher: string; place: string | null };
export type FieldErrors = Record<string, string>;

export const ADULT_AGE = 18; // من زاد فرق السنة عنده على 18 بالغ؛ يطابق قيد minors_need_guardian في قاعدة البيانات
export const MAX_TEXT = 500;
export const MIN_PASSWORD = 8;
export const MAX_NAME = 80;
export const MAX_ACCOUNTS_PER_PHONE = 6; // siblings on a guardian's phone
export const YES = 'نعم';
export const NO = 'لا';

/** thisYear comes from the server, so the browser and the server agree whatever the device clock says. */
export const isMinorIn = (birthYear: number, thisYear: number) => thisYear - birthYear <= ADULT_AGE;
export const isMinor = (birthYear: number, now = new Date()) => isMinorIn(birthYear, now.getFullYear());

/** Arabic-Indic (٠-٩) and the Persian/Kurdish forms (۰-۹) that many Iraqi phone keyboards type, as 0-9. */
export const latinDigits = (input: string) => input.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));

/** Accepts Arabic-Indic, Persian or Latin digits. */
export const toYear = (input: string) => Number(latinDigits(input.trim()));
export const isYearShape = (input: string) => /^\d{4}$/.test(latinDigits(input.trim()));

export const PHONE_EXAMPLE = '07701234567';

/** Digits only (and a leading +), with the country code taken off: what is left should be the 11-digit local number. */
function localDigits(input: string) {
  const rest = latinDigits(input)
    .replace(/[^\d+]/g, '') // spaces, dashes, brackets, and the direction marks that come with a number copied from WhatsApp or Contacts
    .replace(/^(?:\+|00)?964/, '');
  return /^7\d{9}$/.test(rest) ? `0${rest}` : rest; // «770 123 4567», as people write it after +964
}

/**
 * Iraqi mobile numbers, stored as 07XXXXXXXXX. Accepts Arabic-Indic and Persian digits, spaces and dashes, and the
 * +964 / 00964 / 964 prefixes with or without the 0 after them.
 */
export function normalizePhone(input: string): string | null {
  const digits = localDigits(input);
  return /^07[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** Why a phone number was refused, in words a parent can act on. Null when the number is fine. The server and the form share it. */
export function phoneError(input: string, whose: 'student' | 'guardian' = 'student'): string | null {
  if (normalizePhone(input)) return null;
  const digits = localDigits(input);
  if (!/\d/.test(digits)) return whose === 'guardian' ? 'اكتب رقم هاتف ولي الأمر.' : 'اكتب رقم الهاتف.';
  if (/^07[3-9]\d*$/.test(digits)) return `${digits.length < 11 ? 'الرقم ناقص' : 'الرقم أطول من اللازم'}. رقم الهاتف ١١ رقماً، مثل ${PHONE_EXAMPLE}.`;
  return `اكتب رقم هاتف عراقياً يبدأ بـ 07، مثل ${PHONE_EXAMPLE}.`;
}

/** The course a link asked for: `?course=<id>` or the course name (links shared before ids). Undefined when it is not open. */
export function pickCourse(courses: OpenCourse[], wanted: string | undefined) {
  const w = wanted?.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!w) return undefined;
  return courses.find((c) => String(c.id) === latinDigits(w) || c.name.normalize('NFC').trim().replace(/\s+/g, ' ') === w)?.id;
}

/** The registration form's own fields, in the order they appear on the first step. */
export const STUDENT_FIELDS = ['courseId', 'fullName', 'birthYear', 'phone', 'password', 'guardianName', 'guardianPhone', 'guardianConsent'];

/**
 * Where to take the user after a failed check: the step that holds the first problem, and the field to focus there
 * (the first one in screen order, whatever order the errors arrived in). `questionIds` are the questions on screen, in
 * order. An error about the whole form, or about a question that is no longer shown, has no field: it belongs to the
 * last step, where the message above the form explains it.
 */
export function errorTarget(errors: FieldErrors, questionIds: number[]): { step: 0 | 1 | 2; field: string | null } {
  const student = STUDENT_FIELDS.find((k) => errors[k]);
  if (student) return { step: 0, field: student };
  const question = questionIds.map((id) => `q${id}`).find((k) => errors[k]);
  if (question) return { step: 1, field: question };
  return { step: 2, field: null };
}

/** The questions to ask, in order. A question whose condition depends on a hidden question stays hidden. */
export function visibleQuestions(questions: FormQuestion[], answers: Answers) {
  const shown: FormQuestion[] = [];
  const live: Answers = {};
  for (const q of questions) {
    if (!isVisible(q, live)) continue;
    shown.push(q);
    live[String(q.id)] = answers[String(q.id)];
  }
  return shown;
}

/** A question is asked when it has no condition, or its condition's question was answered with that value. */
export function isVisible(q: FormQuestion, answers: Answers) {
  if (!q.showIf) return true;
  const other = answers[String(q.showIf.question_id)];
  return Array.isArray(other) ? other.includes(q.showIf.equals) : other === q.showIf.equals;
}
