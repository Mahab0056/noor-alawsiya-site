/**
 * «أهلاً بيك بالدورة»: every school fact the welcome page and the accept WhatsApp text need, in ONE file.
 *
 * `null` = the school has not told us yet. The page then shows a marked gap («ينتظر المدرسة») and the WhatsApp text
 * leaves the line out. Nothing here is guessed: when the school answers, change the value; nothing else changes.
 * The list of gaps for `awsiya-school-questions` is `welcomeGaps()` in lib/welcome.ts (a test keeps it in step).
 * Import-free, so tests and client code can read it.
 */

export const GAP_LABEL = 'ينتظر المدرسة';

export type WelcomeFacts = {
  /** Day(s) and hour of the lesson, e.g. «السبت والثلاثاء، العصر». The course has none in the school record. */
  time: string | null;
  /** The place comes from the course's own record (courses.place). This is the fallback for a course whose place is empty. */
  placeFallback: string | null;
  /** What the student brings to the first lesson, one item per line. */
  bring: string[] | null;
  /** The school's dress rule for the lesson hall. */
  dress: string | null;
  /** Where the family finds the link of the recorded lesson (lane awsiya-lessons-phase3). */
  lessonsLink: string | null;
  /** How to tell the teacher about an absence, and what the school does after repeated absence. */
  absence: string | null;
  /** The person (name and role) a family asks first. The school's WhatsApp and phone are already public (CONTACT in lib/data.ts). */
  contactPerson: string | null;
};

export const WELCOME_FACTS: WelcomeFacts = {
  time: null,
  placeFallback: null,
  bring: null,
  dress: null,
  lessonsLink: null,
  absence: null,
  contactPerson: null,
};

/** The question to ask the school for each missing fact. Used by welcomeGaps() and the RESULT. */
export const FACT_QUESTIONS: Record<keyof WelcomeFacts, string> = {
  time: 'ما أيام كل حلقة وساعتها؟',
  placeFallback: 'أين تُقام الحلقة للدورات التي لا مكان لها في السجل؟',
  bring: 'ماذا يحمل الطالب معه في أول يوم (مصحف، دفتر، غير ذلك)؟',
  dress: 'ما ضابط اللباس في القاعة للطلاب والطالبات؟',
  lessonsLink: 'أين تجد العائلة رابط الدرس المصوّر (واتساب الدورة أم الحساب)، ولمن يُرسل؟',
  absence: 'كيف يُبلَّغ الأستاذ بالغياب، وماذا يحدث بعد تكراره؟',
  contactPerson: 'من الشخص الذي تسأله العائلة أولاً (الاسم والصفة)؟',
};

/** Flag WELCOME_PAGE: off unless exactly «1» or «true». Read per request (proxy.ts, pages), never at build time. */
export function welcomeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.WELCOME_PAGE?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

