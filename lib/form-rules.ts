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
export const YES = 'نعم';
export const NO = 'لا';

export const isMinor = (birthYear: number, now = new Date()) => now.getFullYear() - birthYear <= ADULT_AGE;

/** Accepts Arabic-Indic or Latin digits. */
export const toYear = (input: string) => Number(input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));

/** A question is asked when it has no condition, or its condition's question was answered with that value. */
export function isVisible(q: FormQuestion, answers: Answers) {
  if (!q.showIf) return true;
  const other = answers[String(q.showIf.question_id)];
  return Array.isArray(other) ? other.includes(q.showIf.equals) : other === q.showIf.equals;
}
