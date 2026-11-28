'use server';

import { refresh } from 'next/cache';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { addTeamMember, removeTeamMember, TeamError } from '@/lib/team';

// Every action below checks the admin session itself. A Server Action is a public endpoint.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

const MESSAGE: Record<TeamError['code'], string> = {
  name: 'اكتب اسم المشرف.',
  email: 'اكتب بريداً إلكترونياً صحيحاً.',
  exists: 'هذا البريد مسجّل لمشرف من قبل.',
  self: 'لا يمكنك حذف حسابك أنت.',
  last: 'لا يمكن حذف آخر مشرف.',
};

export type TeamState = { error?: string; saved: number } | undefined;

export async function addAdminAction(prev: TeamState, form: FormData): Promise<TeamState> {
  const admin = await requireAdmin();
  const saved = prev?.saved ?? 0;
  try {
    await addTeamMember(await getDb(), admin.id, { name: text(form, 'name'), email: text(form, 'email') });
  } catch (e) {
    if (e instanceof TeamError) return { error: MESSAGE[e.code], saved };
    throw e;
  }
  refresh();
  return { saved: saved + 1 };
}

export async function removeAdminAction(form: FormData) {
  const admin = await requireAdmin();
  const n = Number(text(form, 'id'));
  if (Number.isSafeInteger(n) && n > 0) {
    try {
      await removeTeamMember(await getDb(), admin.id, n);
    } catch (e) {
      if (!(e instanceof TeamError)) throw e; // the page offers no button for these cases; a forged post changes nothing
    }
  }
  refresh();
}
