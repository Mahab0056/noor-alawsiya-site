import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logoutAction } from '@/app/actions';
import { CourseRequestForm } from '@/components/CourseRequestForm';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { courseRequestContext, MAX_ACCOUNT_REQUESTS_PER_DAY } from '@/lib/course-requests';
import { ar, CONTACT } from '@/lib/data';
import { getDb } from '@/lib/db';
import { progressEnabled } from '@/lib/flags';
import { formatDate, STATUS_LABEL, STATUS_TAG } from '@/lib/format';
import { ATTENDANCE_LABEL, ATTENDANCE_TAG, baghdadToday, formatDay, pupilProgress, type PupilCourse } from '@/lib/progress';
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
  const [requests, ctx, params, progress] = await Promise.all([
    listStudentRegistrations(db, student.id),
    courseRequestContext(db, student.id),
    searchParams,
    progressEnabled() ? pupilProgress(db, student.id) : [],
  ]);
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
        {progress.map((p) => (
          <Progress key={p.courseId} p={p} firstName={student.fullName.trim().split(/\s+/)[0]} />
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

/** «الحضور والملاحظات» for one accepted course: the pupil's own sessions, newest first. Words, not scores. */
function Progress({ p, firstName }: { p: PupilCourse; firstName: string }) {
  const total = p.present + p.absent + p.excused;
  const today = baghdadToday();
  const headingId = `pg-${p.courseId}`;
  return (
    <section className="card pg" aria-labelledby={headingId}>
      <div className="pg-hd">
        <h2 id={headingId}>الحضور والملاحظات: {p.course}</h2>
        {total === 0 ? (
          <p className="mute">لم يُسجَّل حضور بعد. يسجّل الأستاذ الحضور بعد كل حلقة، ويظهر هنا أول ما يسجّله. لا شيء مطلوب منك الآن.</p>
        ) : (
          <p className="pg-sum">
            حضر {firstName} {ar(p.present)} من {ar(total)} {total === 1 ? 'حلقة مسجّلة' : 'حلقات مسجّلة'}.
            {p.absent ? ` غائب: ${ar(p.absent)}.` : ''}
            {p.excused ? ` مجاز: ${ar(p.excused)}.` : ''}
          </p>
        )}
      </div>
      {p.sessions.length ? (
        <ul className="pg-list">
          {p.sessions.map((s) => (
            <li key={s.day}>
              <span className={`tag ${ATTENDANCE_TAG[s.status]}`}>{ATTENDANCE_LABEL[s.status]}</span>
              <span>{formatDay(s.day, today)}</span>
              {s.note ? (
                <p className="pg-note">
                  <b>ملاحظة الأستاذ:</b> {s.note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pg-ft mute">هذه المتابعة يراها الطالب وولي أمره والأستاذ وإدارة المدرسة فقط.{p.absent ? ' إن كان هناك ظرف، أخبر الأستاذ أو إدارة المدرسة.' : ''}</p>
    </section>
  );
}
