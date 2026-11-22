'use server';

import { redirect } from 'next/navigation';
import { addCampaignLink, type CampaignErrors } from '@/lib/campaigns';
import { getDb } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/session';

// A Server Action is a public endpoint: it checks for a super admin itself, and addCampaignLink checks the role again.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export type CampaignState = { errors?: CampaignErrors; error?: string } | undefined;

export async function addCampaignAction(_prev: CampaignState, form: FormData): Promise<CampaignState> {
  const admin = await requireSuperAdmin();
  const r = await addCampaignLink(await getDb(), admin.id, { name: text(form, 'name'), target: text(form, 'target'), courseId: text(form, 'course') });
  if (!r.ok) return { errors: r.errors, error: 'راجع الحقول المعلّمة.' };
  // The page opens on the new link: its address, its QR code and the two downloads.
  redirect(`/admin/campaigns?show=${r.id}#made`);
}
