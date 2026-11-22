import Link from 'next/link';
import { Icon } from './Icon';
import type { IconName } from '@/lib/icons';
import { CONTACT, KIND_TAG, LATEST_YEAR, TEACHERS, type Course, type CourseKind } from '@/lib/data';
import { courseSlug, coursePath, whatsappShareHref } from '@/lib/share';

const KIND_ICON: Record<CourseKind, IconName> = { tajweed: 'book', tahqiq: 'cert', nagham: 'mic' };

/** Initial for the avatar: first letter of the first teacher's name, after the honorific. */
function initial(teacher: string) {
  return teacher.replace(/^(الشيخ|الأستاذ|السيد|القارئ)\s+/, '').trim()[0];
}

export function NotStated() {
  return <span className="na">غير مذكور</span>;
}

/**
 * `openId` is the database id when the course takes registrations now (lib/public-courses.ts): the card then shows
 * «التسجيل مفتوح» and a «سجّل» link that preselects the course. Every other course, and every course when the database
 * could not be read, gets «اسأل» on WhatsApp: the record alone cannot say who takes new students.
 */
export function CourseCard({ course, openId }: { course: Course; openId?: number }) {
  const isNew = LATEST_YEAR !== '' && course.start?.includes(LATEST_YEAR);
  const slug = courseSlug(course);
  return (
    <article className="card course">
      <div className="hd">
        <span className="ico">
          <Icon name={course.kind ? KIND_ICON[course.kind] : 'book'} size="l" />
        </span>
        <div className="tags">
          {openId !== undefined ? (
            <span className="tag ok">
              <i />
              التسجيل مفتوح
            </span>
          ) : null}
          {isNew ? <span className="tag y">جديد</span> : null}
          {course.kind ? <span className="tag">{KIND_TAG[course.kind]}</span> : null}
        </div>
        {/* prefetch off: six course pages (and their share script) would load with the home page and slow its first paint. */}
        <h3>{slug ? <Link href={coursePath(slug)} prefetch={false}>{course.name}</Link> : course.name}</h3>
        <p>{course.kindLabel ?? 'نوع الدورة غير مذكور'}</p>
      </div>
      <div className="bd">
        <div>
          <Icon name="pin" size="s" />
          <span>{course.place ?? <NotStated />}</span>
        </div>
        <div>
          <Icon name="cal" size="s" />
          <span>{course.start ? `بدأت في ${course.start}` : <NotStated />}</span>
        </div>
      </div>
      <div className="ft">
        <div className="t">
          <span className="av y" aria-hidden="true">
            {initial(course.teacher)}
          </span>
          <span>
            <span className="mute">بإشراف</span>
            <br />
            <b>{course.teacher}</b>
          </span>
        </div>
        {openId !== undefined ? (
          <Link className="btn k sm" href={`/register?course=${openId}`} aria-label={`سجّل في ${course.name}`}>
            سجّل
          </Link>
        ) : (
          <a className="btn o sm" href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`اسأل عن ${course.name} عبر واتساب`}>
            اسأل
          </a>
        )}
      </div>
      {slug ? (
        <div className="sh">
          {/* Server-rendered link only: no client script on the home page. Copy and the share sheet are on the course page. */}
          <a className="btn ok sm" href={whatsappShareHref(course.name, slug)} target="_blank" rel="noopener noreferrer">
            <Icon name="msg" size="s" />
            شارك بالواتساب<span className="vh">: {course.name}</span>
          </a>
        </div>
      ) : null}
    </article>
  );
}

export function TeacherGrid() {
  return (
    <div className="g4">
      {TEACHERS.map((t) => (
        <div className="card tch" key={t.name}>
          <span className="av lg" aria-hidden="true">
            {t.name[0]}
          </span>
          <div>
            <b>{t.name}</b>
            <small>{t.title}</small>
            {t.specialty ? <span className="tag">{t.specialty}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
