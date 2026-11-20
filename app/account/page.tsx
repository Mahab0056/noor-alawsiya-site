import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logoutAction } from '@/app/actions';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { CONTACT } from '@/lib/data';
import { getDb } from '@/lib/db';
import { formatDate, STATUS_LABEL, STATUS_TAG } from '@/lib/format';
import { listStudentRegistrations, type RegistrationStatus } from '@/lib/registration';
import { requireStudent } from '@/lib/session';

export const metadata: Metadata = { title: 'حسابي', robots: { index: false, follow: false } };

const EXPLAIN: Record<RegistrationStatus, string> = {
  pending: 'وصل طلبك إلى إدارة المدرسة وهو قيد المراجعة. ستظهر النتيجة هنا.',
  accepted: 'قُبل طلبك. ستتواصل معك إدارة المدرسة بموعد الحلقة ومكانها.',
  rejected: 'لم يُقبل الطلب هذه المرة. يمكنك التواصل مع إدارة المدرسة للاستفسار.',
};

export default function AccountPage() {
  return (
    <>
      <SiteHeader current="account" />
      <main id="main">
        <section className="sec">
          <div className="wrap acct">
            <Suspense fallback={<p className="card empty">جارٍ التحميل…</p>}>
              <Account />
            </Suspense>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

async function Account() {
  const student = await requireStudent();
  const requests = await listStudentRegistrations(await getDb(), student.id);
  return (
    <>
      <div className="ph">
        <div>
          <h1>أهلاً، {student.fullName}</h1>
          <p>هنا تتابع طلبات تسجيلك في دورات المدرسة.</p>
        </div>
        <form className="sp" action={logoutAction}>
          <button className="btn w sm" type="submit">
            تسجيل الخروج
          </button>
        </form>
      </div>
      <div className="status">
        {requests.map((r) => (
          <article className="card" key={r.id}>
            <span className={`tag ${STATUS_TAG[r.status]}`}>
              <i />
              {STATUS_LABEL[r.status]}
            </span>
            <h2>{r.course}</h2>
            <p className="mute">
              بإشراف {r.teacher} · أُرسل الطلب في {formatDate(r.createdAt)}
            </p>
            <p>{EXPLAIN[r.status]}</p>
            {r.adminNote ? (
              <p className="alert info">
                <b>ملاحظة الإدارة:</b> {r.adminNote}
              </p>
            ) : null}
          </article>
        ))}
        <p className="mute">
          للاستفسار أو لتصحيح بياناتك أو حذفها، راسل إدارة المدرسة على{' '}
          <a className="linkbtn" href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
            واتساب
          </a>
          .
        </p>
      </div>
    </>
  );
}
