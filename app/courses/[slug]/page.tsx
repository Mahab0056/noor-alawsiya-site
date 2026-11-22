import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { NotStated } from '@/components/Cards';
import { CourseRegisterLink } from '@/components/CourseRegisterLink';
import { Icon } from '@/components/Icon';
import { JsonLd } from '@/components/JsonLd';
import { ShareCourse } from '@/components/ShareCourse';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { CONTACT, KIND_TAG } from '@/lib/data';
import { getPublicCourses } from '@/lib/public-courses-cache';
import { courseLd } from '@/lib/seo';
import { COURSE_PAGES, courseBySlug, courseMetadata, registerHref } from '@/lib/share';

// One page per course in the record, built at `next build` (no database read there). Any other slug renders notFound().
// «سجّل» follows the database like the home and /courses cards (lib/public-courses-cache.ts): only a course that is
// published and open gets it, with its id; while the database cannot be read the page offers WhatsApp only.

export function generateStaticParams() {
  return COURSE_PAGES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<'/courses/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const course = courseBySlug(slug);
  return course ? courseMetadata(course, slug) : {};
}

export default async function CoursePage({ params }: PageProps<'/courses/[slug]'>) {
  const { slug } = await params;
  const course = courseBySlug(slug);
  if (!course) notFound();

  const facts: [string, React.ReactNode][] = [
    ['نوع الدورة', course.kindLabel ?? <NotStated />],
    ['بإشراف', course.teacher],
    ['المكان', course.place ?? <NotStated />],
    ['البداية', course.start ?? <NotStated />],
  ];
  if (course.status === 'done') facts.push(['المتخرجون', course.graduates ?? <NotStated />]);
  const open = course.status === 'open'; // the record: still running
  const live = await getPublicCourses();
  const openId = live?.openByName[course.name]; // the database: takes new students now
  const registerLabel = 'سجّل في هذه الدورة';
  const ld = courseLd(course, slug, openId); // Course data only while it takes registrations and is not «تخرّجت»

  return (
    <>
      {ld ? <JsonLd data={ld} /> : null}
      <SiteHeader current="courses" />
      <main id="main">
        <section className="phead">
          <div className="wrap">
            <p className="eye">
              <Link href="/courses">سجل المدرسة</Link>
            </p>
            <h1>{course.name}</h1>
            <div className="ctags">
              {course.kind ? <span className="tag y">{KIND_TAG[course.kind]}</span> : null}
              {openId !== undefined ? (
                <span className="tag ok">
                  <i />
                  التسجيل مفتوح
                </span>
              ) : null}
              {open ? (
                <span className="tag ok">
                  <i />
                  قائمة
                </span>
              ) : course.status === 'done' ? (
                <span className="tag k">تخرّجت</span>
              ) : (
                <span className="tag">الحالة غير مذكورة</span>
              )}
            </div>
            {course.note ? <p>{course.note}</p> : null}
          </div>
        </section>

        <section className="sec" style={{ paddingTop: 36 }}>
          <div className="wrap cpage">
            <div className="card cfacts">
              <dl>
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="acts">
                {openId !== undefined ? (
                  <Suspense
                    fallback={
                      <Link className="btn y" href={registerHref(openId)}>
                        {registerLabel}
                      </Link>
                    }
                  >
                    <CourseRegisterLink course={openId} label={registerLabel} />
                  </Suspense>
                ) : null}
                <a className={openId !== undefined ? 'btn o' : 'btn k'} href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
                  <Icon name="msg" size="s" />
                  اسأل المدرسة على واتساب
                </a>
              </div>
            </div>

            <section className="card cshare" aria-labelledby="share-h">
              <h2 id="share-h">شارك الدورة</h2>
              <p className="mute">أرسل رابط الدورة لمن يهمّه الأمر، في محادثة أو مجموعة واتساب.</p>
              <ShareCourse name={course.name} slug={slug} />
            </section>
          </div>
          <p className="wrap" style={{ marginTop: 18 }}>
            <Link className="back" href="/courses">
              كل الدورات والأساتذة
            </Link>
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
