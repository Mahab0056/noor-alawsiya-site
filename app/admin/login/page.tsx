import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AdminLoginForm } from '@/components/LoginForms';
import { Logo } from '@/components/SiteChrome';
import { adminTotpEnabled } from '@/lib/flags';
import { currentAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'دخول الإدارة', robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <main className="auth" id="main">
      <div className="card box">
        <Logo sub="لوحة الإدارة" />
        <h1>دخول الإدارة</h1>
        <p className="sub">للمشرفين فقط. الدخول بكلمة المرور، ثم رمز يصل إلى بريدك على كل جهاز جديد.</p>
        <Suspense fallback={null}>
          <SignedOutOnly />
        </Suspense>
      </div>
    </main>
  );
}

async function SignedOutOnly() {
  if (await currentAdmin()) redirect('/admin');
  return <AdminLoginForm appCode={adminTotpEnabled()} />;
}
