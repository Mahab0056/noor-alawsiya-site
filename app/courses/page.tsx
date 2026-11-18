import type { Metadata } from 'next';
import { NotStated, TeacherGrid } from '@/components/Cards';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
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

export default function CoursesPage() {
  const facts: [string, string][] = [
    [ar(COURSES.length), 'دورة'],
    [ar(OPEN_COURSES.length), 'قائمة الآن'],
    [ar(DONE_COURSES.length), 'تخرّجت'],
    [ar(TEACHERS.length), 'أستاذاً'],
  ];
  return (
    <>
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
                    <tr key={c.name}>
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
                  ))}
                </tbody>
              </table>
            </div>
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
