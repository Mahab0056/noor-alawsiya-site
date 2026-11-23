import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { logoutAction } from '@/app/actions';
import { CourseRequestForm } from '@/components/CourseRequestForm';
import { Icon } from '@/components/Icon';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { courseRequestContext, MAX_ACCOUNT_REQUESTS_PER_DAY } from '@/lib/course-requests';
import { ar, CONTACT } from '@/lib/data';
import { getDb } from '@/lib/db';
import { formatDate, STATUS_LABEL, STATUS_TAG } from '@/lib/format';
import { listStudentRegistrations, type RegistrationStatus } from '@/lib/registration';
import { requireStudent } from '@/lib/session';
import { welcomeEnabled, welcomePath, welcomeSlugFor } from '@/lib/welcome';

export const metadata: Metadata = { title: 'حسابي', robots: { index: false, follow: false } };

const EXPLAIN: Record<RegistrationStatus, string> = {
  pending: 'وصل طلبك إلى إدارة المدرسة وهو قيد المراجعة. ستظهر النتيجة هنا.',
  accepted: 'قُبل طلبك. ستتواصل معك إدارة المدرسة بموعد الحلقة ومكانها.',
  rejected: 'لم يُقبل الطلب هذه المرة. يمكنك التواصل مع إدارة المدرسة للاستفسار.',
  duplicate: 'وصلنا هذا الطلب مرتين، فأُغلقت هذه النسخة حتى لا يُراجع مرتين. تظهر النتيجة على الطلب الأول.',
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
  const showWelcome = welcomeEnabled(); // flag WELCOME_PAGE: off = no link
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
      {/* Straight after registering. Shown only while a request is waiting, so an old link cannot say «وصل» about nothing. */}
      {params.new === '1' && requests.some((r) => r.status === 'pending') ? (
        <section className="card done" role="status" aria-labelledby="done-title">
          <span className="ic" aria-hidden="true">
            <Icon name="check" />
          </span>
          <div>
            {/* The same text whether or not the phone already had a request waiting for this course (DUPLICATE_HINTS):
                anyone can type any phone into the public form, so a different text would tell them that a family on that
                number, often a minor's guardian, has asked for this course. It would also tell a sibling «already sent». */}
            <h2 id="done-title">وصل طلب التسجيل</h2>
            <p>تراجع إدارة المدرسة الطلب، وتظهر النتيجة في هذه الصفحة.</p>
            <p>
              للعودة إليها لاحقاً: ادخل برقم الهاتف <b className="num">{student.phone}</b> وكلمة المرور التي اخترتها.
            </p>
          </div>
        </section>
      ) : null}
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
            {showWelcome && r.status === 'accepted' && welcomeSlugFor(r.course) ? (
              <p>
                <Link className="btn w sm" href={welcomePath(welcomeSlugFor(r.course)!)}>
                  أهلاً بيك بالدورة: ما تحتاجه قبل أول يوم
                </Link>
              </p>
            ) : null}
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
