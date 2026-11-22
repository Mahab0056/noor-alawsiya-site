import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { deleteSessionAction, setRecorderAction } from '@/app/admin/progress/actions';
import { AdminShell } from '@/components/AdminShell';
import { AttendanceForm } from '@/components/AttendanceForm';
import { countRequests } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { progressEnabled } from '@/lib/flags';
import {
  baghdadToday, earliestDay, formatDay, getCourseName, getRoster, isDay, listAssignable, listCourseRecorders, listSessions, recordAccess,
} from '@/lib/progress';
import { requireRecorder } from '@/lib/session';

export const metadata: Metadata = { title: 'تسجيل الحضور', robots: { index: false, follow: false } };

export default function CourseProgressPage({ params, searchParams }: PageProps<'/admin/progress/[id]'>) {
  return (
    <Suspense fallback={null}>
      <CourseDay params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const ROLE = { teacher: 'أستاذ', staff: 'مشرف', owner: 'مشرف', super_admin: 'مدير أعلى' } as const;

async function CourseDay({ params, searchParams }: Pick<PageProps<'/admin/progress/[id]'>, 'params' | 'searchParams'>) {
  const admin = await requireRecorder();
  if (!progressEnabled()) notFound();
  const { id } = await params;
  const courseId = /^\d{1,15}$/.test(id) ? Number(id) : 0;
  const db = await getDb();
  const access = courseId ? await recordAccess(db, admin.id, courseId) : null;
  if (!access) notFound(); // another teacher's course looks the same as no course

  const query = await searchParams;
  const today = baghdadToday();
  const asked = typeof query.date === 'string' ? query.date : today;
  if (!isDay(asked) || asked > today) redirect(`/admin/progress/${courseId}`);
  const day = asked;
  const earliest = earliestDay(access.isSuper, today);
  const readOnly = day < earliest;

  const [course, roster, sessions, counts, recorders, assignable] = await Promise.all([
    getCourseName(db, courseId),
    getRoster(db, admin.id, courseId, day),
    listSessions(db, admin.id, courseId),
    admin.role === 'teacher' ? null : countRequests(db),
    access.isSuper ? listCourseRecorders(db, courseId) : [],
    access.isSuper ? listAssignable(db) : [],
  ]);
  if (!course || !roster) notFound();
  const free = assignable.filter((a) => !recorders.some((r) => r.adminId === a.adminId));

  return (
    <AdminShell admin={admin} current="progress" pending={counts?.pending ?? 0}>
      <div className="ph">
        <div>
          <h1>{course.name}</h1>
          <p>
            {course.teacher} · {ar(roster.rows.length)} طالب مقبول
          </p>
        </div>
        <div className="sp">
          <Link className="btn w sm" href="/admin/progress">
            كل الحلقات
          </Link>
        </div>
      </div>
      {query.deleted === '1' ? (
        <p className="alert ok" role="status">
          حُذفت الحلقة وسجل حضورها.
        </p>
      ) : null}
      <div className="row">
        <section className="card" aria-labelledby="att-h">
          <div className="ch">
            <h2 id="att-h">
              حضور {formatDay(day, today)}
              {day === today ? ' (اليوم)' : ''}
            </h2>
          </div>
          <form className="att-day" method="get">
            <div className="field">
              <label htmlFor="date">يوم الحلقة</label>
              <input id="date" name="date" type="date" className="inp ltr" defaultValue={day} max={today} min={access.isSuper ? earliest : undefined} />
            </div>
            <button className="btn w" type="submit">
              عرض اليوم
            </button>
          </form>
          {readOnly ? (
            <p className="alert info" style={{ margin: '16px 22px 0' }}>
              انتهى وقت التعديل لهذا اليوم: يُعدَّل الحضور حتى الجمعة من الأسبوع نفسه. للتصحيح راسل إدارة المدرسة.
            </p>
          ) : null}
          {roster.rows.length === 0 ? (
            <p className="empty">لا يوجد طلاب مقبولون في هذه الدورة بعد. يظهر هنا كل طالب يُقبل طلبه.</p>
          ) : readOnly && roster.sessionId === null ? (
            <p className="empty">لم يُسجَّل حضور لهذا اليوم.</p>
          ) : (
            <AttendanceForm key={`${courseId}-${day}`} courseId={courseId} day={day} rows={roster.rows} readOnly={readOnly} />
          )}
          {access.isSuper && roster.sessionId !== null ? (
            <details className="att-del">
              <summary>حذف حلقة هذا اليوم</summary>
              <form action={deleteSessionAction}>
                <input type="hidden" name="course" value={courseId} />
                <input type="hidden" name="date" value={day} />
                <span className="mute">يُحذف سجل حضور كل الطلاب لهذا اليوم، ويختفي من حساباتهم.</span>
                <button className="btn sm no" type="submit">
                  نعم، احذف الحلقة
                </button>
              </form>
            </details>
          ) : null}
        </section>

        <div>
          <section className="card" aria-labelledby="sess-h">
            <div className="ch">
              <h2 id="sess-h">الحلقات المسجّلة</h2>
            </div>
            {sessions.length === 0 ? (
              <p className="empty">لم تُسجَّل حلقة بعد.</p>
            ) : (
              <ul className="rec-list sess-list">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/admin/progress/${courseId}?date=${s.day}`} aria-current={s.day === day ? 'page' : undefined}>
                      <b>{formatDay(s.day, today)}</b>
                      <span className="mute">
                        {ar(s.present)} حاضر · {ar(s.absent)} غائب{s.excused ? ` · ${ar(s.excused)} مجاز` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {access.isSuper ? (
            <section className="card" aria-labelledby="rec-h" style={{ marginTop: 18 }}>
              <div className="ch">
                <h2 id="rec-h">من يسجّل لهذه الدورة</h2>
              </div>
              <p className="mute" style={{ padding: '6px 22px 0', fontSize: 14 }}>
                المدير الأعلى يسجّل لكل الدورات. أضف الأستاذ (أو المشرف الذي يسجّل عنه) ليرى هذه الحلقة وحدها.
              </p>
              {recorders.length === 0 ? (
                <p className="mute" style={{ padding: '10px 22px 0', fontSize: 14 }}>
                  لا أحد بعد.
                </p>
              ) : (
                <ul className="rec-list">
                  {recorders.map((r) => (
                    <li key={r.adminId}>
                      <span>
                        <b>{r.name || r.email}</b> <small className="mute">{ROLE[r.role]}</small>
                      </span>
                      <form action={setRecorderAction}>
                        <input type="hidden" name="course" value={courseId} />
                        <input type="hidden" name="admin" value={r.adminId} />
                        <button className="btn sm no" name="on" value="0" aria-label={`إزالة ${r.name || r.email} من هذه الدورة`}>
                          إزالة
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              {free.length > 0 ? (
                <form className="rec-add" action={setRecorderAction}>
                  <input type="hidden" name="course" value={courseId} />
                  <input type="hidden" name="on" value="1" />
                  <label className="vh" htmlFor="rec-admin">
                    من يسجّل
                  </label>
                  <select id="rec-admin" name="admin" className="inp">
                    {free.map((a) => (
                      <option key={a.adminId} value={a.adminId}>
                        {a.name || a.email} ({ROLE[a.role]})
                      </option>
                    ))}
                  </select>
                  <button className="btn k" type="submit">
                    إضافة
                  </button>
                </form>
              ) : (
                <p className="mute" style={{ padding: '10px 22px 20px', fontSize: 14 }}>
                  لا يوجد أستاذ أو مشرف مفعّل آخر لإضافته. ادعُ الأستاذ من «المشرفون» بدور «أستاذ».
                </p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </AdminShell>
  );
}
