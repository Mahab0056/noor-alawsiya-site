'use server';

import { refresh } from 'next/cache';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { markNotified, removeEntry } from '@/lib/waitlist';

// Every action checks the admin session itself: a Server Action is a public endpoint.

const entryId = (form: FormData) => {
  const v = form.get('id');
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : 0;
  return n > 0 ? n : null;
};

/** «تم التبليغ»: the admin says the message was sent from their phone. */
export async function waitlistNotifiedAction(form: FormData) {
  const admin = await requireAdmin();
  const id = entryId(form);
  if (id) await markNotified(await getDb(), admin.id, id);
  refresh();
}

/** «احذف»: removes the entry and blanks the phone and the name. */
export async function waitlistRemoveAction(form: FormData) {
  const admin = await requireAdmin();
  const id = entryId(form);
  if (id) await removeEntry(await getDb(), admin.id, id);
  refresh();
}
