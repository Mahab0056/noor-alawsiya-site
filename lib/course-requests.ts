import 'server-only';
import type { Db } from './db';
import { isMinor, type FieldErrors } from './form-rules';
import { listOpenCourses, type RegistrationStatus } from './registration';

/**
 * A signed-in student asks for another course from «حسابي» without typing their details again.
 *
 * Rules (the server decides; the form only shows what is likely to pass):
 * - The student comes from the session only. Callers pass the id they got from requireStudent(); nothing in the form names a student.
 * - One live request per student and course: a pending or accepted request blocks another one (partial unique index
 *   registrations_one_live_idx, 0007). After a rejection the course can be asked for again.
 * - At most MAX_ACCOUNT_REQUESTS_PER_DAY requests from the account in any 24 hours (the first one, made with the
 *   registration form, does not count).
 * - A student who is under 18 now needs a fresh «ولي الأمر موافق على هذا الطلب» each time; the time of that tick is kept
 *   on the request. The guardian is the one already on file: nothing new is collected.
 * - Nothing is logged: no console output, no audit row. The admin sees the request in the normal list.
 */

export const MAX_ACCOUNT_REQUESTS_PER_DAY = 3;
export const MAX_STUDENT_NOTE = 300;

export type CourseChoice = { id: number; name: string; teacher: string; place: string | null; taken: Extract<RegistrationStatus, 'pending' | 'accepted'> | null };

export type RequestContext = {
  minor: boolean;
  /** The guardian on file, masked (first letter of each word), for a minor; null otherwise. */
  guardianMasked: string | null;
  leftToday: number;
  courses: CourseChoice[];
};

export type CourseRequestInput = { courseId: string; note: string; guardianConsent: boolean };
export type CourseRequestResult = { ok: true; registrationId: number } | { ok: false; errors: FieldErrors };

/** «جاسم محمد علي» → «ج… م… ع…». Enough for the student to recognise, not enough to read over a shoulder. */
export function maskName(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${[...word][0]}…`)
    .join(' ');
}

const ALREADY: Record<'pending' | 'accepted', string> = {
  pending: 'لديك طلب قيد المراجعة لهذه الدورة. ستظهر النتيجة في حسابك.',
  accepted: 'أنت مقبول في هذه الدورة من قبل.',
};
const CAP = `وصلت إلى الحد اليومي (${MAX_ACCOUNT_REQUESTS_PER_DAY} طلبات). حاول غداً، أو تواصل مع إدارة المدرسة.`;
const NO_GUARDIAN = 'لا يوجد ولي أمر مسجّل في حسابك. تواصل مع إدارة المدرسة لإكمال الطلب.';

type StudentRow = { birth_year: number; guardian_name: string | null };

async function leftToday(db: Db, studentId: number) {
  const [{ n }] = await db.query<{ n: string }>(
    `select count(*) as n from registrations where student_id = $1 and origin = 'account' and created_at > now() - interval '24 hours'`,
    [studentId]
  );
  return Math.max(0, MAX_ACCOUNT_REQUESTS_PER_DAY - Number(n));
}

/** What the «اطلب دورة ثانية» section needs to show for this student. */
export async function courseRequestContext(db: Db, studentId: number, now = new Date()): Promise<RequestContext | null> {
  const [s] = await db.query<StudentRow>('select birth_year, guardian_name from students where id = $1', [studentId]);
  if (!s) return null;
  const minor = isMinor(s.birth_year, now);
  const live = await db.query<{ course_id: string; status: 'pending' | 'accepted' }>(
    `select course_id, status from registrations where student_id = $1 and status in ('pending', 'accepted')`,
    [studentId]
  );
  const taken = new Map(live.map((r) => [Number(r.course_id), r.status]));
  const courses = (await listOpenCourses(db)).map((c): CourseChoice => ({ id: c.id, name: c.name, teacher: c.teacher, place: c.place, taken: taken.get(c.id) ?? null }));
  return { minor, guardianMasked: minor && s.guardian_name ? maskName(s.guardian_name) : null, leftToday: await leftToday(db, studentId), courses };
}

/** Validates and stores one request for an existing student. `studentId` must come from the session. */
export async function requestCourse(db: Db, studentId: number, input: CourseRequestInput, now = new Date()): Promise<CourseRequestResult> {
  const errors: FieldErrors = {};
  const note = input.note.trim();
  if ([...note].length > MAX_STUDENT_NOTE) errors.note = `الملاحظة أطول من ${MAX_STUDENT_NOTE} حرف.`;

  const course = /^\d{1,15}$/.test(input.courseId) ? (await listOpenCourses(db)).find((c) => c.id === Number(input.courseId)) : undefined;
  if (!course) errors.courseId = 'اختر دورة من الدورات المفتوحة.';

  const [s] = await db.query<StudentRow>('select birth_year, guardian_name from students where id = $1', [studentId]);
  if (!s) return { ok: false, errors: { form: 'انتهت الجلسة. سجّل الدخول من جديد.' } };
  const minor = isMinor(s.birth_year, now);
  if (minor && !s.guardian_name) return { ok: false, errors: { form: NO_GUARDIAN } };
  if (minor && !input.guardianConsent) errors.guardianConsent = 'الطلب لمن هو دون ١٨ سنة يحتاج موافقة ولي الأمر على هذا الطلب.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const store = () =>
    db.tx(async (t): Promise<CourseRequestResult> => {
      // One student's requests are decided one at a time, so two at once cannot both pass the checks below.
      await t.query('select id from students where id = $1 for update', [studentId]);
      const [live] = await t.query<{ status: 'pending' | 'accepted' }>(
        `select status from registrations where student_id = $1 and course_id = $2 and status in ('pending', 'accepted') limit 1`,
        [studentId, course!.id]
      );
      if (live) return { ok: false, errors: { courseId: ALREADY[live.status] } };
      if ((await leftToday(t, studentId)) === 0) return { ok: false, errors: { form: CAP } };
      const [reg] = await t.query<{ id: string }>(
        `insert into registrations (student_id, course_id, origin, student_note, guardian_consent_at) values ($1, $2, 'account', $3, $4) returning id`,
        [studentId, course!.id, note || null, minor ? now : null]
      );
      return { ok: true, registrationId: Number(reg.id) };
    });
  try {
    return await store();
  } catch (e) {
    // The unique index is the last word if two requests for the same course still meet.
    if ((e as { code?: string }).code === '23505') return { ok: false, errors: { courseId: ALREADY.pending } };
    throw e;
  }
}
