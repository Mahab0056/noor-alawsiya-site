import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { InviteForm } from '@/components/InviteForm';
import { Logo } from '@/components/SiteChrome';
import { getDb } from '@/lib/db';
import { INVALID_INVITE, THROTTLED } from '@/lib/invite-messages';
import { viewInvite } from '@/lib/invites';
import { clientIp } from '@/lib/session';

// The token is in the address: no index, and no referrer to any other site.
export const metadata: Metadata = { title: 'قبول دعوة الإدارة', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function InvitePage({ params }: PageProps<'/admin/invite/[token]'>) {
  return (
    <main className="auth" id="main">
      <div className="card box">
        <Logo sub="لوحة الإدارة" />
        <h1>قبول دعوة الإدارة</h1>
        <Suspense fallback={null}>
          <Invite params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Invite({ params }: Pick<PageProps<'/admin/invite/[token]'>, 'params'>) {
  await connection(); // per request, never prerendered: it reads the database and the client address
  const { token } = await params;
  const view = await viewInvite(await getDb(), token, await clientIp());
  if (!view.ok) {
    return (
      <p className="alert bad" role="alert">
        {view.reason === 'throttled' ? THROTTLED : INVALID_INVITE}
      </p>
    );
  }
  return (
    <>
      <p className="sub">
        الدعوة موجّهة إلى <span className="num">{view.email}</span>.{' '}
        اكتب اسمك وادخل. بعدها يكون الدخول برمز يصل إلى هذا البريد في كل مرة.
      </p>
      <InviteForm token={token} />
    </>
  );
}
