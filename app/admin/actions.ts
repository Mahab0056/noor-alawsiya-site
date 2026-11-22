'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestAdminCode, verifyAdminCode } from '@/lib/accounts';
import { addQuestion, moveQuestion, recordNotified, reviewRequest, setQuestionActive, validateQuestion, type QuestionInput } from '@/lib/admin';
import { getDb } from '@/lib/db';
import { listQuestions, NO, YES, type QuestionKind, type RegistrationStatus } from '@/lib/registration';
import { clientIp, endSession, requireAdmin, startSession } from '@/lib/session';

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

// Login is in two steps, both through this one action: ask for a code, then send it back.
// The address rides along in the form, so the second step is a plain post with no state to keep in sync.
export type AdminLoginState = { step: 'email' | 'code'; email: string; error?: string } | undefined;

const TOO_MANY = 'محاولات كثيرة. انتظر ربع ساعة ثم حاول مرة أخرى.';

export async function adminLoginAction(_prev: AdminLoginState, form: FormData): Promise<AdminLoginState> {
  const email = text(form, 'email').trim();
  const ip = await clientIp();

  if (text(form, 'intent') !== 'verify') {
    const result = await requestAdminCode(await getDb(), email, ip);
    if (result.ok) return { step: 'code', email };
    return { step: 'email', email, error: result.reason === 'throttled' ? TOO_MANY : 'تعذّر إرسال الرمز. حاول بعد قليل.' };
  }

  const result = await verifyAdminCode(await getDb(), email, text(form, 'code'), ip);
  if (result.ok) {
    await startSession('admin', result.adminId);
    redirect('/admin');
  }
  return { step: 'code', email, error: result.reason === 'throttled' ? TOO_MANY : 'الرمز غير صحيح أو انتهت صلاحيته.' };
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
  // Keep the course filter the admin was working in (digits only; the page ignores an unknown course).
  const course = /^\d{1,15}$/.test(text(form, 'course')) ? `&course=${text(form, 'course')}` : '';
  if (requestId && (decision === 'accepted' || decision === 'rejected')) {
    const result = await reviewRequest(await getDb(), admin.id, requestId, decision, text(form, 'note'));
    if (result === 'conflict') redirect(`/admin?status=${from}${course}&id=${requestId}&conflict=1#request`);
    redirect(`/admin?status=${decision}${course}&id=${requestId}&done=1#request`); // show the request in its new list, still open
  }
  redirect(`/admin?status=${from}${course}`);
}

/** «إبلاغ عبر واتساب» was pressed: the browser opens wa.me itself; this only writes the audit line (id, no phone). */
export async function notifiedAction(requestId: unknown) {
  const admin = await requireAdmin();
  if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId <= 0) return;
  if (await recordNotified(await getDb(), admin.id, requestId)) refresh();
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
