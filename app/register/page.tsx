import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { RegisterForm } from '@/components/RegisterForm';
import { Logo } from '@/components/SiteChrome';
import { CONTACT } from '@/lib/data';
import { getDb } from '@/lib/db';
import { listOpenCourses, listQuestions } from '@/lib/registration';
import { currentStudent } from '@/lib/session';

export const metadata: Metadata = {
  title: 'التسجيل',
  description: 'سجّل في دورات مدرسة نور الأوصياء للدراسات القرآنية: اختر الدورة، أجب عن استبيان قصير، ثم تراجع الإدارة طلبك.',
};

export default function RegisterPage({ searchParams }: PageProps<'/register'>) {
  return (
    <Suspense fallback={<Shell>جارٍ التحميل…</Shell>}>
      <Register searchParams={searchParams} />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth" id="main">
      <div className="card box">
        <Logo />
        {children}
      </div>
    </main>
  );
}

async function Register({ searchParams }: Pick<PageProps<'/register'>, 'searchParams'>) {
  if (await currentStudent()) redirect('/account');
  const db = await getDb();
  const [courses, questions, params] = await Promise.all([listOpenCourses(db), listQuestions(db), searchParams]);
  if (courses.length === 0) {
    return (
      <Shell>
        <h1>التسجيل غير متاح الآن</h1>
        <p className="sub">لا توجد دورات مفتوحة للتسجيل من الموقع حالياً. تواصل مع إدارة المدرسة.</p>
        <a className="btn k" href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
          واتساب المدرسة
        </a>
        <p className="alt">
          <Link href="/">العودة إلى الرئيسية</Link>
        </p>
      </Shell>
    );
  }
  const wanted = typeof params.course === 'string' ? params.course : undefined;
  // The year is read on the server (Baghdad time) so the under-18 rule matches what the server will enforce.
  const thisYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Baghdad' }).format(new Date()));
  return <RegisterForm courses={courses} questions={questions} preselect={courses.find((c) => c.name === wanted)?.id} thisYear={thisYear} />;
}
