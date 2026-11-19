'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { INVALID_INVITE, THROTTLED } from '@/lib/invite-messages';
import { confirmInviteTotp, setInvitePassword } from '@/lib/invites';
import { qrDataUrl } from '@/lib/qr';
import { clientIp, startSession } from '@/lib/session';

// No session here: the invite token is the credential, and lib/invites.ts checks it (and throttles) on every call.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};


export type InviteState =
  | { step: 'password'; error?: string; errors?: { name?: string; password?: string } }
  | { step: 'totp'; qr: string; secret: string; error?: string }
  | { step: 'dead'; error: string }
  | undefined;

/** One action for both steps, so the page holds a single state. The hidden `step` field says which step was sent. */
export async function inviteAction(prev: InviteState, form: FormData): Promise<InviteState> {
  return text(form, 'step') === 'code' ? confirmStep(prev, form) : passwordStep(form);
}

async function passwordStep(form: FormData): Promise<InviteState> {
  const r = await setInvitePassword(await getDb(), text(form, 'token'), { name: text(form, 'name'), password: text(form, 'password'), confirm: text(form, 'confirm') }, await clientIp());
  if (r.ok) return { step: 'totp', qr: qrDataUrl(r.uri), secret: r.secret };
  if (r.reason === 'form') return { step: 'password', errors: r.errors, error: 'راجع الحقول المعلَّمة.' };
  return { step: 'dead', error: r.reason === 'throttled' ? THROTTLED : INVALID_INVITE };
}

async function confirmStep(prev: InviteState, form: FormData): Promise<InviteState> {
  const r = await confirmInviteTotp(await getDb(), text(form, 'token'), text(form, 'code'), await clientIp());
  if (r.ok) {
    await startSession('admin', r.adminId);
    redirect('/admin');
  }
  if (r.reason === 'code' && prev?.step === 'totp') return { ...prev, error: 'الرمز غير صحيح. اكتب الرمز الظاهر الآن في تطبيق المصادقة.' };
  if (r.reason === 'no-secret' || r.reason === 'code') return { step: 'password', error: 'ابدأ من الخطوة الأولى مرة أخرى.' };
  return { step: 'dead', error: r.reason === 'throttled' ? THROTTLED : INVALID_INVITE };
}
