'use server';

import { refresh } from 'next/cache';
import { getDb } from '@/lib/db';
import { InviteError, inviteAdmin, resendInvite, revokeInvite, setAdminDisabled, unlockAdmin } from '@/lib/invites';
import { MailConfigError, mailConfig } from '@/lib/mail';
import { requireSuperAdmin } from '@/lib/session';

// Every action checks for a super admin itself (a Server Action is a public endpoint), and lib/invites.ts checks the
// role again against the database.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};
const targetId = (form: FormData) => {
  const n = Number(text(form, 'id'));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export type TeamState = { error?: string; ok?: string } | undefined;

function explain(e: unknown): string {
  if (e instanceof MailConfigError) return 'إرسال البريد غير مهيأ على الخادم بعد، فلم يُنشأ شيء. أخبر مشغّل الموقع.';
  if (e instanceof InviteError) {
    switch (e.code) {
      case 'bad-email': return 'البريد الإلكتروني غير صحيح.';
      case 'already-active': return 'هذا المشرف مفعّل. لإعادة تفعيله برابط جديد اختر «إعادة دعوة» من القائمة.';
      case 'not-pending': return 'هذا المشرف مفعّل.';
      case 'self': return 'لا يمكنك تطبيق هذا على حسابك.';
      case 'not-super': return 'هذا للمدير الأعلى فقط.';
      default: return 'لم يتم. حدّث الصفحة وحاول مرة أخرى.';
    }
  }
  return 'تعذّر إرسال البريد الآن. لم يُنشأ شيء؛ حاول بعد قليل.';
}

export async function inviteAction(_prev: TeamState, form: FormData): Promise<TeamState> {
  const admin = await requireSuperAdmin();
  const role = text(form, 'role') === 'super_admin' ? 'super_admin' : 'staff';
  try {
    await inviteAdmin(await getDb(), { email: text(form, 'email'), role, actorId: admin.id }, { mail: mailConfig() });
  } catch (e) {
    return { error: explain(e) };
  }
  refresh();
  return { ok: 'أُرسلت الدعوة. الرابط يصلح مرة واحدة ولمدة ٤٨ ساعة.' };
}

/** Fresh link for a pending admin; with reset=1, for an active admin (sessions and login codes end until they accept). */
export async function resendAction(_prev: TeamState, form: FormData): Promise<TeamState> {
  const admin = await requireSuperAdmin();
  const id = targetId(form);
  if (!id) return { error: 'تعذّر تنفيذ الطلب. حدّث الصفحة وحاول مرة أخرى.' };
  try {
    await resendInvite(await getDb(), admin.id, id, { mail: mailConfig() }, { reset: text(form, 'reset') === '1' });
  } catch (e) {
    return { error: explain(e) };
  }
  refresh();
  return { ok: 'أُرسلت دعوة جديدة، والرابط السابق لم يعد يعمل.' };
}

async function simple(form: FormData, run: (actorId: number, id: number) => Promise<void>): Promise<TeamState> {
  const admin = await requireSuperAdmin();
  const id = targetId(form);
  if (!id) return { error: 'تعذّر تنفيذ الطلب. حدّث الصفحة وحاول مرة أخرى.' };
  try {
    await run(admin.id, id);
  } catch (e) {
    return { error: explain(e) };
  }
  refresh();
  return { ok: 'تمّ التنفيذ.' };
}

export async function revokeAction(_prev: TeamState, form: FormData) {
  return simple(form, async (actor, id) => revokeInvite(await getDb(), actor, id));
}
export async function disableAction(_prev: TeamState, form: FormData) {
  return simple(form, async (actor, id) => setAdminDisabled(await getDb(), actor, id, text(form, 'disabled') === '1'));
}
export async function unlockAction(_prev: TeamState, form: FormData) {
  return simple(form, async (actor, id) => unlockAdmin(await getDb(), actor, id));
}
