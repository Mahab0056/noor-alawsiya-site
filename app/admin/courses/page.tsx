import type { Metadata } from 'next';
import { Suspense } from 'react';
import { setCourseOpenAction } from '@/app/admin/courses/actions';
import { AdminShell } from '@/components/AdminShell';
import { CourseForm } from '@/components/CourseForm';
import { countRequests } from '@/lib/admin';
import { listCoursesForAdmin, type AdminCourse } from '@/lib/courses';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'الدورات', robots: { index: false, follow: false } };

export default function AdminCoursesPage() {
  return (
    <Suspense fallback={null}>
      <Courses />
    </Suspense>
  );
}

function StateTag({ c }: { c: AdminCourse }) {
  if (c.accepting) return <span className="tag ok">تقبل التسجيل</span>;
  if (c.status === 'done') return <span className="tag">منتهية</span>;
  return <span className="tag warn">التسجيل مغلق</span>;
}

async function Courses() {
  const admin = await requireSuperAdmin();
  const db = await getDb();
  const [courses, counts] = await Promise.all([listCoursesForAdmin(db), countRequests(db)]);
  const open = courses.filter((c) => c.accepting).length;

  return (
    <AdminShell admin={admin} current="courses" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>الدورات</h1>
          <p>
            الدورات التي تظهر في نموذج التسجيل. تقبل التسجيل الآن: {ar(open)} من {ar(courses.length)}. إغلاق التسجيل لا يمس الطلبات التي وصلت.
          </p>
        </div>
      </div>
      <div className="row">
        <div className="card">
          <div className="ch">
            <h2>كل الدورات</h2>
          </div>
          {courses.length === 0 ? <p className="empty">لا توجد دورات بعد. أضف أول دورة من النموذج المجاور.</p> : null}
          <ol className="qlist">
            {courses.map((c, i) => (
              <li className={`qrow${c.accepting ? '' : ' off'}`} key={c.id}>
                <span className="qn">{ar(i + 1)}</span>
                <div>
                  <b>{c.name}</b>
                  <div className="qmeta">
                    <StateTag c={c} />
                    <span className="mute">{c.teacher}</span>
                    {c.place ? <span className="mute">{c.place}</span> : null}
                    <span className="mute">البدء: {c.startedOn ?? 'غير مذكور'}</span>
                    {c.pending > 0 ? <span className="tag y">{ar(c.pending)} قيد المراجعة</span> : null}
                    {c.accepted > 0 ? <span className="mute">{ar(c.accepted)} مقبول</span> : null}
                  </div>
                </div>
                <div className="sp">
                  {c.status === 'done' && !c.accepting ? null : (
                    <form action={setCourseOpenAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className={`btn sm ${c.accepting ? 'no' : 'w'}`} name="open" value={c.accepting ? '0' : '1'} aria-label={`${c.accepting ? 'إغلاق التسجيل في' : 'فتح التسجيل في'} ${c.name}`}>
                        {c.accepting ? 'إغلاق التسجيل' : 'فتح التسجيل'}
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="qfoot mute">الدورة لا تُحذف. الدورة المنتهية تبقى في القائمة بلا زر فتح.</p>
        </div>
        <div className="card q">
          <h2 className="qh">دورة جديدة</h2>
          <CourseForm />
        </div>
      </div>
    </AdminShell>
  );
}
