'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginAdmin } from '@/lib/accounts';
import { ADMIN_CODE_COOKIE, ADMIN_DEVICE_COOKIE } from '@/lib/cookie-names';
import { CODE_MINUTES, rememberDevice, verifyLoginCode } from '@/lib/email-codes';
import { addQuestion, moveQuestion, recordNotified, reviewRequest, setQuestionActive, validateQuestion, type QuestionInput } from '@/lib/admin';
import { getDb } from '@/lib/db';
import { triesLeftText } from '@/lib/format';
import { listQuestions, NO, YES, type QuestionKind, type RegistrationStatus } from '@/lib/registration';
import { appOrigin } from '@/lib/mail';
import { clientIp, endSession, requireAdmin, startSession } from '@/lib/session';
import { resetStudentPassword, tempPasswordMessage } from '@/lib/student-reset';
import { DEFAULT_ORIGIN, whatsappLink, type NotifyRecipient } from '@/lib/whatsapp';

// Every action below checks the admin session itself. A Server Action is a public endpoint.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};
const id = (form: FormData) => {
  const n = Number(text(form, 'id'));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const STATUSES: RegistrationStatus[] = ['pending', 'accepted', 'rejected'];
const KINDS: QuestionKind[] = ['single', 'multi', 'yes_no', 'text'];

export type AdminLoginState = { step?: 'password'; error: string } | { step: 'code'; error?: string } | undefined;

const THROTTLED = 'محاولات كثيرة. انتظر ربع ساعة ثم حاول مرة أخرى.';
const secureCookie = () => process.env.NODE_ENV === 'production';

/** Step 1: e-mail and password (and the app code if ADMIN_TOTP=1). Step 2 (`step=code`): the code sent by e-mail. */
export async function adminLoginAction(prev: AdminLoginState, form: FormData): Promise<AdminLoginState> {
  if (text(form, 'step') === 'code') return codeStep(form);
  const store = await cookies();
  const result = await loginAdmin(await getDb(), text(form, 'email'), text(form, 'password'), text(form, 'code').trim(), await clientIp(), {
    deviceToken: store.get(ADMIN_DEVICE_COOKIE)?.value,
  });
  if (result.ok) {
    await startSession('admin', result.adminId);
    redirect('/admin');
  }
  if (result.reason === 'code-sent') {
    store.set(ADMIN_CODE_COOKIE, result.challenge, { httpOnly: true, secure: secureCookie(), sameSite: 'strict', path: '/admin', maxAge: CODE_MINUTES * 60 });
    return { step: 'code' };
  }
  if (result.reason === 'throttled') return { error: THROTTLED };
  if (result.reason === 'mail-failed') return { error: 'تعذّر إرسال رمز الدخول بالبريد الآن. حاول بعد قليل.' };
  return { error: 'بيانات الدخول غير صحيحة.' };
}

async function codeStep(form: FormData): Promise<AdminLoginState> {
  const store = await cookies();
  const result = await verifyLoginCode(await getDb(), store.get(ADMIN_CODE_COOKIE)?.value, text(form, 'code'));
  if (!result.ok) {
    if (result.reason === 'code') return { step: 'code', error: `الرمز غير صحيح. ${triesLeftText(result.triesLeft)} لهذا الرمز.` };
    store.delete({ name: ADMIN_CODE_COOKIE, path: '/admin' });
    return { error: 'انتهت صلاحية الرمز أو كثرت المحاولات. ادخل بكلمة المرور من جديد ليصلك رمز جديد.' };
  }
  store.delete({ name: ADMIN_CODE_COOKIE, path: '/admin' });
  if (form.get('remember') === 'on') {
    const device = await rememberDevice(await getDb(), result.adminId);
    if (device) store.set(ADMIN_DEVICE_COOKIE, device.token, { httpOnly: true, secure: secureCookie(), sameSite: 'lax', path: '/admin', expires: device.expiresAt });
  }
  await startSession('admin', result.adminId);
  redirect('/admin');
}

export async function adminLogoutAction() {
  await endSession('admin');
  redirect('/admin/login');
}

export async function reviewAction(form: FormData) {
  const admin = await requireAdmin();
  const requestId = id(form);
  const decision = text(form, 'decision');
  const from = STATUSES.find((s) => s === text(form, 'from')) ?? 'pending';
  if (requestId && (decision === 'accepted' || decision === 'rejected')) {
    const result = await reviewRequest(await getDb(), admin.id, requestId, decision, text(form, 'note'));
    if (result === 'conflict') redirect(`/admin?status=${from}&id=${requestId}&conflict=1#request`);
    redirect(`/admin?status=${decision}&id=${requestId}&done=1#request`); // show the request in its new list, still open
  }
  redirect(`/admin?status=${from}`);
}

/** «إبلاغ عبر واتساب» was pressed: the browser opens wa.me itself; this only writes the audit line (id, no phone). */
export async function notifiedAction(requestId: unknown) {
  const admin = await requireAdmin();
  if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId <= 0) return;
  if (await recordNotified(await getDb(), admin.id, requestId)) refresh();
}

export type StudentResetState = { password: string; link: string | null; to: NotifyRecipient } | { error: string } | undefined;

/**
 * «كلمة مرور مؤقتة»: for the student behind request `id`. The password comes back once, in this answer only (never in a
 * URL, a log or the database), with a prepared wa.me link to the number on file.
 */
export async function studentResetAction(_prev: StudentResetState, form: FormData): Promise<StudentResetState> {
  const admin = await requireAdmin();
  const requestId = id(form);
  if (!requestId) return { error: 'تعذّر تنفيذ الطلب. حدّث الصفحة وحاول مرة أخرى.' };
  const reset = await resetStudentPassword(await getDb(), admin.id, requestId);
  if (!reset) return { error: 'لم يُعثر على هذا الطلب. حدّث الصفحة.' };
  let origin = DEFAULT_ORIGIN;
  try {
    origin = appOrigin();
  } catch {}
  return { password: reset.password, to: reset.to, link: reset.number ? whatsappLink(reset.number, tempPasswordMessage(reset.password, origin)) : null };
}

export type QuestionState ={ error?: string; saved: number } | undefined;

export async function addQuestionAction(prev: QuestionState, form: FormData): Promise<QuestionState> {
  const admin = await requireAdmin();
  const kind = KINDS.find((k) => k === text(form, 'kind'));
  const saved = prev?.saved ?? 0;
  if (!kind) return { error: 'اختر نوع السؤال.', saved };
  // The condition arrives as "<question id>|<answer>".
  const [condId, ...condRest] = text(form, 'showIf').split('|');
  const showIf = condId && condRest.length ? { question_id: Number(condId), equals: condRest.join('|') } : null;
  if (showIf && !Number.isSafeInteger(showIf.question_id)) return { error: 'شرط الظهور غير صالح.', saved };
  if (showIf) {
    // The condition must point at an answer that an active choice question can actually give.
    const target = (await listQuestions(await getDb())).find((q) => q.id === showIf.question_id);
    const answers = target?.kind === 'yes_no' ? [YES, NO] : target?.kind === 'text' ? [] : (target?.options ?? []);
    if (!answers.includes(showIf.equals)) return { error: 'شرط الظهور غير صالح.', saved };
  }
  const input: QuestionInput = { label: text(form, 'label'), kind, options: text(form, 'options').split(/\r?\n/), required: form.get('required') === 'on', showIf };
  const error = validateQuestion(input);
  if (error) return { error, saved };
  await addQuestion(await getDb(), admin.id, input);
  refresh();
  return { saved: saved + 1 };
}

export async function toggleQuestionAction(form: FormData) {
  const admin = await requireAdmin();
  const questionId = id(form);
  if (questionId) await setQuestionActive(await getDb(), admin.id, questionId, text(form, 'active') === '1');
  refresh();
}

export async function moveQuestionAction(form: FormData) {
  const admin = await requireAdmin();
  const questionId = id(form);
  const direction = text(form, 'direction');
  if (questionId && (direction === 'up' || direction === 'down')) await moveQuestion(await getDb(), admin.id, questionId, direction);
  refresh();
}
