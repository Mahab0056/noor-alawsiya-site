'use server';

import { redirect } from 'next/navigation';
import { loginStudent } from '@/lib/accounts';
import { isThrottled, recordAttempt } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { register, type Answers, type FieldErrors } from '@/lib/registration';
import { clientIp, endSession, startSession } from '@/lib/session';

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
  // Each stored registration counts against the address it came from, so one connection cannot flood the admin's inbox.
  const db = await getDb();
  const ip = await clientIp();
  const bucket = `register:${ip}`;
  if (await isThrottled(db, 'student', bucket, ip)) return { errors: { form: 'طلبات كثيرة من هذا الاتصال. حاول بعد ربع ساعة.' } };
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
  await recordAttempt(db, 'student', bucket, ip, false);
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

export async function logoutAction() {
  await endSession('student');
  redirect('/login');
}
