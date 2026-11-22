import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { countRequests } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { progressEnabled } from '@/lib/flags';
import { baghdadToday, formatDay, listRecordableCourses } from '@/lib/progress';
import { requireRecorder } from '@/lib/session';

export const metadata: Metadata = { title: 'الحضور', robots: { index: false, follow: false } };

export default function ProgressPage() {
  return (
    <Suspense fallback={null}>
      <Courses />
    </Suspense>
  );
}

async function Courses() {
  const admin = await requireRecorder();
  const teacher = admin.role === 'teacher';
  if (!progressEnabled()) {
    if (!teacher) notFound();
    return (
      <AdminShell admin={admin} current="progress" pending={0}>
        <p className="card empty">متابعة الحضور غير مفعّلة الآن. ستظهر حلقاتك هنا حين تفعّلها إدارة المدرسة.</p>
      </AdminShell>
    );
  }
  const db = await getDb();
  const [courses, counts] = await Promise.all([listRecordableCourses(db, admin.id), teacher ? null : countRequests(db)]);
  const today = baghdadToday();

  return (
    <AdminShell admin={admin} current="progress" pending={counts?.pending ?? 0}>
      <div className="ph">
        <div>
          <h1>الحضور</h1>
          <p>
            {teacher
              ? 'حلقاتك. سجّل الحضور بعد كل حلقة، ومعه ملاحظة قصيرة لكل طالب إن أردت؛ يراها الطالب وولي أمره في «حسابي».'
              : 'تسجيل حضور الحلقات. المدير الأعلى يسجّل لأي دورة ويحدّد من يسجّل لكل دورة؛ غيره يسجّل لدوراته فقط.'}
          </p>
        </div>
      </div>
      <div className="card">
        {courses.length === 0 ? (
          <p className="empty">{teacher ? 'لم تُسند إليك حلقة بعد. اطلب من إدارة المدرسة أن تضيفك إلى دورتك.' : 'لا توجد دورة تستطيع التسجيل لها.'}</p>
        ) : (
          <ol className="qlist">
            {courses.map((c, i) => (
              <li className={`qrow${c.done ? ' off' : ''}`} key={c.id}>
                <span className="qn">{ar(i + 1)}</span>
                <div>
                  <b>{c.name}</b>
                  <div className="qmeta">
                    <span className="mute">{c.teacher}</span>
                    <span className={`tag${c.pupils ? ' ok' : ''}`}>{c.pupils ? `مقبولون: ${ar(c.pupils)}` : 'لا طلاب مقبولون بعد'}</span>
                    <span className="mute">{c.lastOn ? `آخر حلقة مسجّلة: ${formatDay(c.lastOn, today)}` : 'لم تُسجَّل حلقة بعد'}</span>
                  </div>
                </div>
                <div className="sp">
                  <Link className={`btn sm ${c.pupils ? 'k' : 'w'}`} href={`/admin/progress/${c.id}`} aria-label={`تسجيل حضور ${c.name}`}>
                    تسجيل الحضور
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="qfoot mute">يُسجَّل الحضور للطلاب المقبولين فقط. الأستاذ يعدّل حتى الجمعة من الأسبوع نفسه، والمدير الأعلى في أي وقت.</p>
      </div>
    </AdminShell>
  );
}
