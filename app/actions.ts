'use server';

import { redirect } from 'next/navigation';
import { loginStudent } from '@/lib/accounts';
import { allowRegistration } from '@/lib/auth';
import { requestCourse } from '@/lib/course-requests';
import { getDb } from '@/lib/db';
import { listOpenCourses, register, type Answers, type FieldErrors } from '@/lib/registration';
import { clientIp, endSession, requireStudent, startSession } from '@/lib/session';
import { allowWaitlist, joinWaitlist, listWaitlistCourses } from '@/lib/waitlist';
import { validateWaitlist } from '@/lib/waitlist-rules';

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export type RegisterState = { errors: FieldErrors } | undefined;

export async function registerAction(_prev: RegisterState, form: FormData): Promise<RegisterState> {
  const answers: Answers = {};
  for (const key of new Set(form.keys())) {
    if (!/^q\d+$/.test(key)) continue;
    const all = form.getAll(key).filter((v): v is string => typeof v === 'string');
    answers[key.slice(1)] = all.length > 1 ? all : all[0];
  }
  // Every submission counts against the address it came from, whether or not it is stored. That keeps one
  // connection from flooding the admin's inbox, and from probing which name and phone pairs already have accounts.
  const db = await getDb();
  if (!(await allowRegistration(db, await clientIp()))) return { errors: { form: 'طلبات كثيرة من هذا الاتصال. حاول بعد ساعة، أو تواصل مع إدارة المدرسة.' } };
  const result = await register(db, {
    fullName: text(form, 'fullName'),
    birthYear: text(form, 'birthYear'),
    phone: text(form, 'phone'),
    password: text(form, 'password'),
    guardianName: text(form, 'guardianName'),
    guardianPhone: text(form, 'guardianPhone'),
    guardianConsent: form.get('guardianConsent') === 'on',
    courseId: text(form, 'courseId'),
    answers,
  });
  if (!result.ok) return { errors: result.errors };
  await startSession('student', result.studentId);
  redirect('/account');
}

export type LoginState = { error?: string; names?: string[]; phone?: string } | undefined;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const phone = text(form, 'phone');
  const result = await loginStudent(await getDb(), phone, text(form, 'password'), await clientIp(), text(form, 'fullName') || undefined);
  if (result.ok) {
    await startSession('student', result.studentId);
    redirect('/account');
  }
  if (result.reason === 'choose') return { names: result.names, phone };
  if (result.reason === 'throttled') return { error: 'محاولات كثيرة. انتظر ربع ساعة ثم حاول مرة أخرى.', phone };
  return { error: 'رقم الهاتف أو كلمة المرور غير صحيحة.', phone };
}

/** `sent` counts the answers, so the form can start fresh from `courseId` and `note` after each one (the guardian's tick is not kept). */
export type CourseRequestState = { errors: FieldErrors; courseId: string; note: string; sent: number } | undefined;

/**
 * «اطلب دورة ثانية» on /account. A Server Action is a public endpoint: the session is checked here, and the student is
 * the one in the session. The form carries no student id; anything of the kind that is posted is never read.
 */
export async function requestCourseAction(prev: CourseRequestState, form: FormData): Promise<CourseRequestState> {
  const student = await requireStudent(); // signed out: sent to /login
  const courseId = text(form, 'courseId');
  const note = text(form, 'note');
  const result = await requestCourse(await getDb(), student.id, { courseId, note, guardianConsent: form.get('guardianConsent') === 'on' });
  if (!result.ok) return { errors: result.errors, courseId: courseId.slice(0, 20), note: note.slice(0, 1000), sent: (prev?.sent ?? 0) + 1 };
  redirect('/account?sent=1');
}

export async function logoutAction() {
  await endSession('student');
  redirect('/login');
}

/** «بلّغوني لما تنفتح». `done` replaces the form with the thank-you; a repeat of the same phone and course looks the same. */
export type WaitlistState = { done: true } | { done?: false; errors: FieldErrors; values: { phone: string; guardianName: string; courseId: string; ageBand: string } } | undefined;

/**
 * Public, no session. Order: honeypot, validation, per-address caps, store. The honeypot answers like a success and stores
 * nothing. Nothing is logged and nothing is sent: the team messages people by hand from /admin/waitlist.
 */
export async function waitlistAction(_prev: WaitlistState, form: FormData): Promise<WaitlistState> {
  if (text(form, 'website')) return { done: true };
  const values = { phone: text(form, 'phone').slice(0, 40), guardianName: text(form, 'guardianName').slice(0, 200), courseId: text(form, 'courseId').slice(0, 20), ageBand: text(form, 'ageBand').slice(0, 20) };
  const db = await getDb();
  const checked = validateWaitlist({ ...values, consent: form.get('consent') === 'on' }, (await listWaitlistCourses(db)).map((c) => c.id));
  if (!checked.ok) {
    // A course that opened while the form was on screen: say so, rather than a vague error.
    if (checked.errors.courseId && (await listOpenCourses(db)).some((c) => String(c.id) === values.courseId)) {
      checked.errors.courseId = 'هالدورة انفتح بيها التسجيل هسه. تگدر تسجّل من صفحة التسجيل.';
    }
    return { errors: checked.errors, values };
  }
  if (!(await allowWaitlist(db, await clientIp()))) return { errors: { form: 'طلبات كثيرة من هذا الاتصال. جرّب بعد ساعة، أو راسلنا على واتساب المدرسة.' }, values };
  if ((await joinWaitlist(db, checked.value)) === 'full') return { errors: { form: 'القائمة مزدحمة اليوم. جرّب باچر، أو راسلنا على واتساب المدرسة.' }, values };
  return { done: true };
}
