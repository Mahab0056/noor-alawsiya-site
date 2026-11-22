'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { INVALID_INVITE, THROTTLED } from '@/lib/invite-messages';
import { acceptInvite } from '@/lib/invites';
import { clientIp, startSession } from '@/lib/session';

// No session here: the invite token is the credential, and lib/invites.ts checks it (and throttles) on every call.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export type InviteState = { step: 'name'; error?: string; errors?: { name?: string } } | { step: 'dead'; error: string } | undefined;

/** The one step: a name. The link came by e-mail, so the admin is active and signed in at once. */
export async function inviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const r = await acceptInvite(await getDb(), text(form, 'token'), { name: text(form, 'name') }, await clientIp());
  if (r.ok) {
    await startSession('admin', r.adminId);
    redirect('/admin');
  }
  if (r.reason === 'form') return { step: 'name', errors: r.errors, error: 'راجع الحقول المعلَّمة.' };
  return { step: 'dead', error: r.reason === 'throttled' ? THROTTLED : INVALID_INVITE };
}
