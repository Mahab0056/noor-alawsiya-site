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

const latinDigits = (input: string) => input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** Accepts Arabic-Indic or Latin digits. */
export const toYear = (input: string) => Number(latinDigits(input.trim()));

/** Iraqi mobile numbers, stored as 07XXXXXXXXX. Accepts +964 / 00964 prefixes, spaces and Arabic-Indic digits. */
export function normalizePhone(input: string): string | null {
  const digits = latinDigits(input)
    .replace(/[^\d+]/g, '')
    .replace(/^(\+964|00964|964)/, '0');
  return /^07[3-9]\d{8}$/.test(digits) ? digits : null;
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
