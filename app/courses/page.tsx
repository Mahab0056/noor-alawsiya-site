import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Fragment, Suspense } from 'react';
import { NotStated, TeacherGrid } from '@/components/Cards';
import { Icon } from '@/components/Icon';
import { JsonLd } from '@/components/JsonLd';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { WaitlistForm } from '@/components/WaitlistForm';
import { COURSES_LD } from '@/lib/seo';
import { getDb } from '@/lib/db';
import { listWaitlistCourses, type WaitCourse } from '@/lib/waitlist';
import { ar, countOf, COURSES, DONE_COURSES, OPEN_COURSES, TEACHERS, type CourseStatus } from '@/lib/data';

export const metadata: Metadata = {
  title: 'الدورات والأساتذة',
  description: 'سجل دورات مدرسة نور الأوصياء منذ ٢٠٢١: الدورات القائمة والمتخرجة، أساتذتها وأماكنها وتواريخها.',
};

function Status({ status }: { status: CourseStatus }) {
  if (status === 'open')
    return (
      <span className="tag ok">
        <i />
        قائمة
      </span>
    );
  if (status === 'done') return <span className="tag k">تخرّجت</span>;
  return <span className="tag">غير مذكور</span>;
}

/** `waitFor`: courses, by name, that a visitor can wait for. Without it (the static shell, or no database) the table has no forms. */
function CourseTable({ waitFor }: { waitFor?: Map<string, WaitCourse> }) {
  return (
    <div className="card tw">
      <table className="rec">
        <thead>
          <tr>
            <th scope="col">الدورة</th>
            <th scope="col">الأستاذ</th>
            <th scope="col">المكان</th>
            <th scope="col">البداية</th>
            <th scope="col">الحالة</th>
            <th scope="col">المتخرجون</th>
          </tr>
        </thead>
        <tbody>
          {COURSES.map((c) => (
            <Fragment key={c.name}>
              <tr className={waitFor?.has(c.name) ? 'has-wl' : undefined}>
                <td data-l="">
                  <b>{c.name}</b>
                  <small>{c.kindLabel ?? <NotStated />}</small>
                </td>
                <td data-l="الأستاذ">{c.teacher}</td>
                <td data-l="المكان">{c.place ?? <NotStated />}</td>
                <td data-l="البداية">{c.start ?? <NotStated />}</td>
                <td data-l="الحالة">
                  <Status status={c.status} />
                  {c.note ? <small>{c.note}</small> : null}
                </td>
                <td data-l="المتخرجون">{c.graduates ?? <NotStated />}</td>
              </tr>
              {waitFor?.has(c.name) ? <WaitlistRow course={waitFor.get(c.name)!} /> : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** «بلّغوني لما تنفتح» under a course that is not taking registrations and has not finished. */
function WaitlistRow({ course }: { course: WaitCourse }) {
  return (
    <tr className="wl-row">
      <td colSpan={6}>
        <details className="wl-details">
          <summary>
            <Icon name="bell" size="s" />
            بلّغوني لما تنفتح<span className="vh"> {course.name}</span>
          </summary>
          <WaitlistForm prefix={`wl${course.id}`} course={course} />
        </details>
      </td>
    </tr>
  );
}

async function CourseTableWithWaitlist() {
  await connection();
  let waitFor = new Map<string, WaitCourse>();
  try {
    waitFor = new Map((await listWaitlistCourses(await getDb())).map((c) => [c.name, c]));
  } catch {
    // The record still shows without the forms if the database cannot be reached.
  }
  return <CourseTable waitFor={waitFor} />;
}

export default function CoursesPage() {
  const facts: [string, string][] = [
    [ar(COURSES.length), 'دورة'],
    [ar(OPEN_COURSES.length), 'قائمة الآن'],
    [ar(DONE_COURSES.length), 'تخرّجت'],
    [ar(TEACHERS.length), 'أستاذاً'],
  ];
  return (
    <>
      <JsonLd data={COURSES_LD} />
      <SiteHeader current="courses" />
      <main id="main">
        <section className="phead">
          <div className="wrap">
            <p className="eye">سجل المدرسة</p>
            <h1>الدورات والأساتذة</h1>
            <p>{countOf(COURSES.length, 'دورات', 'دورة')} منذ ٢٠٢١ في التجويد والقراءة التحقيقية والنغم القرآني، بين البلديات وحي طارق ومدينة الصدر.</p>
            <div className="pk">
              {facts.map(([value, label]) => (
                <div key={label}>
                  <b>{value}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" style={{ paddingTop: 40 }}>
          <div className="wrap">
            <Suspense fallback={<CourseTable />}>
              <CourseTableWithWaitlist />
            </Suspense>
            <p className="mute" style={{ fontSize: 13.5, marginTop: 12 }}>
              «غير مذكور» تعني أن المعلومة ناقصة في سجل المدرسة. دورات القراءة التحقيقية في حي طارق ومدينة الصدر بالتعاون مع معهد القرآن الكريم الذي يشرف عليه الشيخ عقيل الربيعي.
            </p>
          </div>
        </section>

        <section className="sec" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="wrap">
            <div className="sec-h">
              <div>
                <p className="eye">الأساتذة</p>
                <h2>{ar(TEACHERS.length)} أستاذاً وقارئاً</h2>
              </div>
            </div>
            <TeacherGrid />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
