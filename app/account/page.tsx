import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logoutAction } from '@/app/actions';
import { CourseRequestForm } from '@/components/CourseRequestForm';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { courseRequestContext, MAX_ACCOUNT_REQUESTS_PER_DAY } from '@/lib/course-requests';
import { ar, CONTACT } from '@/lib/data';
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

export default function AccountPage({ searchParams }: PageProps<'/account'>) {
  return (
    <>
      <SiteHeader current="account" />
      <main id="main">
        <section className="sec">
          <div className="wrap acct">
            <Suspense fallback={<p className="card empty">جارٍ التحميل…</p>}>
              <Account searchParams={searchParams} />
            </Suspense>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

async function Account({ searchParams }: Pick<PageProps<'/account'>, 'searchParams'>) {
  const student = await requireStudent();
  const db = await getDb();
  const [requests, ctx, params] = await Promise.all([listStudentRegistrations(db, student.id), courseRequestContext(db, student.id), searchParams]);
  const choices = ctx?.courses.filter((c) => c.taken === null) ?? [];
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
      {params.sent === '1' ? (
        <p className="alert ok" role="status">
          وصل طلبك الجديد إلى إدارة المدرسة، وتجده في القائمة أدناه.
        </p>
      ) : null}
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
        {ctx ? (
          <section className="card creq-card" aria-labelledby="new-request">
            <h2 id="new-request">اطلب دورة ثانية</h2>
            {choices.length === 0 ? (
              <p className="mute">لا توجد دورة مفتوحة أخرى تطلبها الآن. ستظهر هنا الدورات الجديدة حين تفتحها المدرسة.</p>
            ) : ctx.leftToday === 0 ? (
              <p className="mute">أرسلت {ar(MAX_ACCOUNT_REQUESTS_PER_DAY)} طلبات خلال يوم. يمكنك إرسال طلب جديد غداً.</p>
            ) : (
              <>
                <p className="mute">بياناتك محفوظة في حسابك، فلا حاجة لكتابتها من جديد. اختر الدورة وأرسل الطلب، وتراجعه الإدارة كأي طلب.</p>
                <CourseRequestForm
                  courses={ctx.courses.map((c) => ({ id: c.id, label: `${c.name} · ${c.teacher}`, taken: c.taken }))}
                  minor={ctx.minor}
                  guardianMasked={ctx.guardianMasked}
                />
              </>
            )}
          </section>
        ) : null}
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
