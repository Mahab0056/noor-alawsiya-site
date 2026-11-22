import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { getDb } from '@/lib/db';
import { currentStudent } from '@/lib/session';
import { CONTACT_LINES, GAP_LABEL, welcomeEnabled, welcomeSections } from '@/lib/welcome';
import { acceptedWelcomeCourse } from '@/lib/welcome-data';

export const metadata: Metadata = { title: 'أهلاً بيك بالدورة', robots: { index: false, follow: false } };

export default function WelcomePage({ params }: PageProps<'/welcome/[course]'>) {
  return (
    <>
      <SiteHeader current="account" />
      <main id="main">
        <section className="sec">
          <div className="wrap acct">
            <Suspense fallback={<p className="card empty">جارٍ التحميل…</p>}>
              <Welcome params={params} />
            </Suspense>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

async function Welcome({ params }: Pick<PageProps<'/welcome/[course]'>, 'params'>) {
  // Flag off is answered by proxy.ts with a real 404. This is the second lock: read per request, here, never at build time.
  await connection();
  if (!welcomeEnabled()) notFound();
  const { course: slug } = await params;
  // Not signed in, no such course, a pending/rejected request, or someone else's course: all the same 404.
  const student = await currentStudent();
  if (!student) notFound();
  const found = await acceptedWelcomeCourse(await getDb(), student.id, slug);
  if (!found) notFound();
  const sections = welcomeSections(found.place);
  return (
    <>
      <div className="ph">
        <div>
          <h1>أهلاً بيك بالدورة</h1>
          <p>{found.course}</p>
        </div>
        <Link className="btn w sm" href="/account">
          العودة إلى حسابي
        </Link>
      </div>
      <div className="status welcome">
        {sections.map((s) => (
          <section className="card" key={s.id} aria-labelledby={`w-${s.id}`}>
            <h2 id={`w-${s.id}`}>{s.title}</h2>
            <ul>
              {s.items.map((item) => (
                <li key={item.text}>
                  {item.gap ? <span className="gap">{item.text}</span> : item.text}
                </li>
              ))}
            </ul>
            {s.id === 'contact' ? (
              <p>
                واتساب المدرسة:{' '}
                <a className="linkbtn" href={CONTACT_LINES.whatsapp} target="_blank" rel="noopener noreferrer">
                  راسلونا
                </a>{' '}
                · الهاتف:{' '}
                <a className="num" href={CONTACT_LINES.phoneHref}>
                  {CONTACT_LINES.phone}
                </a>
              </p>
            ) : null}
          </section>
        ))}
        <p className="mute">
          ما كُتب «{GAP_LABEL}» لم تُبلّغنا به المدرسة بعد، ولن نخمّنه. وهذه الصفحة تعريف بالدورة وليست وعداً بنتيجة أو شهادة.
        </p>
      </div>
    </>
  );
}
