import { Icon } from './Icon';
import type { IconName } from '@/lib/icons';
import { CONTACT, KIND_TAG, TEACHERS, type Course, type CourseKind } from '@/lib/data';

const KIND_ICON: Record<CourseKind, IconName> = { tajweed: 'book', tahqiq: 'cert', nagham: 'mic' };

/** First teacher of a course, without the honorific, for the avatar line. */
function leadTeacher(teacher: string) {
  return teacher
    .split('،')[0]
    .replace(/^(الشيخ|الأستاذ|السيد)\s+/, '')
    .trim();
}

export function NotStated() {
  return <span className="na">غير مذكور</span>;
}

export function CourseCard({ course }: { course: Course }) {
  const lead = leadTeacher(course.teacher);
  const isNew = course.start?.includes('٢٠٢٦');
  return (
    <article className="card course">
      <div className="hd">
        <span className="ico">
          <Icon name={course.kind ? KIND_ICON[course.kind] : 'book'} size="l" />
        </span>
        <div className="tags">
          {isNew ? <span className="tag y">جديد</span> : null}
          {course.kind ? <span className="tag">{KIND_TAG[course.kind]}</span> : null}
        </div>
        <h3>{course.name}</h3>
        <p>{course.kindLabel}</p>
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
            {lead[0]}
          </span>
          <span>
            <span className="mute">الأستاذ</span>
            <br />
            <b>{lead}</b>
          </span>
        </div>
        <a className="btn k sm" href={CONTACT.whatsapp} target="_blank" rel="noopener" aria-label={`سجّل في ${course.name}`}>
          سجّل
        </a>
      </div>
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
