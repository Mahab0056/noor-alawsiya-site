import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { PrintButton } from '@/components/PrintButton';
import { countRequests } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { AGE_GROUP_LABEL, ATTENDANCE_BOXES, getRoster, recordRosterView } from '@/lib/roster';
import { courseRosterOn } from '@/lib/roster-flag';
import { requireAdmin } from '@/lib/session';
import './roster.css';

/**
 * «كشف الدورة» (flag COURSE_ROSTER): accepted students of one course, to print for the teacher's first class.
 * Print only: no CSV, no PDF, no file route. proxy.ts answers this address with 404 while the flag is OFF and adds
 * Cache-Control: no-store and X-Robots-Tag: noindex while it is ON. Every open writes an audit_log row (lib/roster.ts).
 */

export const metadata: Metadata = {
  title: 'كشف الدورة',
  robots: { index: false, follow: false },
};

export default function CourseRosterPage({ params }: PageProps<'/admin/courses/[id]/roster'>) {
  return (
    <Suspense fallback={null}>
      <RosterView params={params} />
    </Suspense>
  );
}

/** An empty cell: a dash on screen and paper, a word for screen readers. */
function None() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="vh">لا يوجد</span>
    </>
  );
}

const FOOTER = 'سري: للمدرسة فقط، لا يُصوّر ولا يُنشر';

async function RosterView({ params }: Pick<PageProps<'/admin/courses/[id]/roster'>, 'params'>) {
  const admin = await requireAdmin(); // the same role as «طلبات التسجيل»; also makes the page per request
  if (!courseRosterOn()) notFound(); // the proxy already answered 404; this is the second lock
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  const db = await getDb();
  const roster = await getRoster(db, Number(id));
  if (!roster) notFound();
  await recordRosterView(db, admin.id, roster.courseId);
  const counts = await countRequests(db);
  const printedOn = formatDate(new Date());
  const n = roster.students.length;

  return (
    <AdminShell admin={admin} current="courses" pending={counts.pending}>
      <div className="roster">
        <div className="ph roster-screen">
          <div>
            <h1>كشف الدورة</h1>
            <p>الطلاب المقبولون فقط، مرتبون بالاسم. للطباعة وتسليم المدرّس في أول حصة. لا يُنزَّل الكشف ملفاً، ويُسجَّل كل فتح له.</p>
          </div>
          <div className="sp roster-actions">
            {admin.role === 'super_admin' ? (
              <Link className="btn w" href="/admin/courses">
                رجوع إلى الدورات
              </Link>
            ) : null}
            <PrintButton>اطبع</PrintButton>
          </div>
        </div>

        <section className="card roster-sheet" aria-labelledby="roster-title">
          <header className="roster-head">
            <h2 id="roster-title">كشف دورة «{roster.courseName}»</h2>
            <dl>
              {roster.teacher ? (
                <div>
                  <dt>المدرّس</dt>
                  <dd>{roster.teacher}</dd>
                </div>
              ) : null}
              <div>
                <dt>عدد الطلاب</dt>
                <dd>{ar(n)}</dd>
              </div>
              <div>
                <dt>تاريخ الطباعة</dt>
                <dd>{printedOn}</dd>
              </div>
            </dl>
          </header>

          {n === 0 ? (
            <>
              <p className="empty">لا يوجد طلاب مقبولون في هذه الدورة بعد.</p>
              <p className="roster-foot">{FOOTER}</p>
            </>
          ) : (
            <div className="roster-wrap" role="region" aria-labelledby="roster-title" tabIndex={0}>
              <table className="roster-table">
                <caption className="vh">الطلاب المقبولون في {roster.courseName}، مرتبون بالاسم</caption>
                <thead>
                  <tr>
                    <th scope="col">ت</th>
                    <th scope="col">اسم الطالب</th>
                    <th scope="col">الفئة العمرية</th>
                    <th scope="col">ولي الأمر</th>
                    <th scope="col">هاتف ولي الأمر</th>
                    <th scope="col">حضور</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.students.map((s, i) => (
                    <tr key={i}>
                      <td className="rn">{ar(i + 1)}</td>
                      <th scope="row">{s.studentName}</th>
                      <td>{AGE_GROUP_LABEL[s.ageGroup]}</td>
                      <td>{s.guardianName ?? <None />}</td>
                      <td>
                        {s.guardianPhone ? (
                          <span className="num" dir="ltr">
                            {s.guardianPhone}
                          </span>
                        ) : (
                          <None />
                        )}
                      </td>
                      <td className="att">
                        <span className="vh">خانات حضور فارغة</span>
                        {Array.from({ length: ATTENDANCE_BOXES }, (_, k) => (
                          <span key={k} className="box" aria-hidden="true" />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* tfoot repeats at the bottom of every printed page (Chrome, Firefox), so the notice never covers a row. */}
                <tfoot>
                  <tr>
                    <td colSpan={6} className="roster-foot">
                      {FOOTER}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
