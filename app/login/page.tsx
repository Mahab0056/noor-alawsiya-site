import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForms';
import { Logo } from '@/components/SiteChrome';
import { currentStudent } from '@/lib/session';

export const metadata: Metadata = { title: 'دخول الطلاب', description: 'ادخل برقم هاتفك وكلمة المرور لمتابعة طلب التسجيل.', robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <main className="auth" id="main">
      <div className="card box">
        <Logo />
        <h1>دخول الطلاب</h1>
        <p className="sub">برقم الهاتف وكلمة المرور التي اخترتها عند التسجيل.</p>
        <Suspense fallback={null}>
          <SignedOutOnly />
        </Suspense>
        <p className="alt">
          ليس لديك حساب؟ <Link href="/register">سجّل في دورة</Link>
        </p>
      </div>
    </main>
  );
}

async function SignedOutOnly() {
  if (await currentStudent()) redirect('/account');
  return <LoginForm />;
}
