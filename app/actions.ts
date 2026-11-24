'use server';

import { redirect } from 'next/navigation';
import { loginStudent } from '@/lib/accounts';
import { allowRegistration } from '@/lib/auth';
import { requestCourse } from '@/lib/course-requests';
import { getDb } from '@/lib/db';
import { countStep, funnelOn, normalizeSource } from '@/lib/funnel';
import { register, type Answers, type FieldErrors } from '@/lib/registration';
import { clientIp, endSession, requireStudent, startSession } from '@/lib/session';

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
  // FUNNEL_COUNTS (lib/funnel.ts): `sent` once the registration limit has let the submission through, `saved` inside the
  // registration's transaction. Neither can throw or stop the registration. Off: no source is read and nothing is counted.
  const source = funnelOn() ? await normalizeSource(db, form.get('from')) : null;
  if (source) await countStep(db, 'sent', source);
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
  }, { funnelSource: source });
  if (!result.ok) return { errors: result.errors };
  await startSession('student', result.studentId);
  redirect('/account?new=1'); // the account page opens on «وصل طلب التسجيل»
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
