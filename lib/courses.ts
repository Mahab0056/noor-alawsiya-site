import 'server-only';
import { audit } from './admin';
import type { Db } from './db';

/**
 * «الدورات» in the admin panel: which courses take new registrations, and new courses.
 *
 * A course appears in the registration form only when it is published AND its status is 'open' (lib/registration.ts
 * listOpenCourses). The school record (lib/data.ts, used by the public pages) calls a course 'open' when it is still
 * running, which is not the same as «accepting new students». So the seed now inserts every course unpublished, and a
 * super admin opens registration here, course by course. A finished course ('done') cannot be opened.
 *
 * Callers must have checked for a super admin first (lib/session.ts requireSuperAdmin). Every change goes to audit_log
 * by course id only.
 */

export type CourseStatus = 'open' | 'done' | 'unknown';
export type AdminCourse = { id: number; name: string; teacher: string; place: string | null; startedOn: string | null; status: CourseStatus; accepting: boolean; pending: number; accepted: number };

export async function listCoursesForAdmin(db: Db): Promise<AdminCourse[]> {
  const rows = await db.query<{ id: string; name: string; teacher: string; place: string | null; started_on: string | null; status: CourseStatus; published: boolean; pending: string; accepted: string }>(
    `select c.id, c.name, c.teacher, c.place, c.started_on, c.status, c.published,
            count(r.id) filter (where r.status = 'pending') as pending,
            count(r.id) filter (where r.status = 'accepted') as accepted
       from courses c left join registrations r on r.course_id = c.id
      group by c.id
      order by (c.published and c.status = 'open') desc, (c.status = 'done'), c.id desc`,
  );
  return rows.map((r) => ({
    id: Number(r.id), name: r.name, teacher: r.teacher, place: r.place, startedOn: r.started_on, status: r.status,
    accepting: r.published && r.status === 'open', pending: Number(r.pending), accepted: Number(r.accepted),
  }));
}

export type OpenResult = 'saved' | 'missing' | 'done';

/** open = take new registrations; closed = hidden from the form. Requests already sent stay as they are. */
export async function setCourseAccepting(db: Db, adminId: number, courseId: number, open: boolean): Promise<OpenResult> {
  const [row] = await db.query<{ status: CourseStatus }>('select status from courses where id = $1', [courseId]);
  if (!row) return 'missing';
  if (open && row.status === 'done') return 'done';
  if (open) await db.query(`update courses set published = true, status = 'open' where id = $1`, [courseId]);
  else await db.query('update courses set published = false where id = $1', [courseId]);
  await audit(db, adminId, open ? 'course.opened' : 'course.closed', `course:${courseId}`);
  return 'saved';
}

export const MAX_COURSE_NAME = 120;
export const MAX_COURSE_TEACHER = 120;
export const MAX_COURSE_PLACE = 160;
export const MAX_COURSE_START = 60;

export type CourseInput = { name: string; teacher: string; place: string; startedOn: string; open: boolean };
export type CourseErrors = Partial<Record<'name' | 'teacher' | 'place' | 'startedOn', string>>;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function validateCourse(input: CourseInput): { ok: true; value: CourseInput } | { ok: false; errors: CourseErrors } {
  const value = { name: clean(input.name), teacher: clean(input.teacher), place: clean(input.place), startedOn: clean(input.startedOn), open: input.open };
  const errors: CourseErrors = {};
  if (value.name.length < 3) errors.name = 'اكتب اسم الدورة (٣ أحرف على الأقل).';
  else if (value.name.length > MAX_COURSE_NAME) errors.name = 'اسم الدورة أطول من اللازم.';
  if (value.teacher.length < 3) errors.teacher = 'اكتب اسم المدرّس (٣ أحرف على الأقل).';
  else if (value.teacher.length > MAX_COURSE_TEACHER) errors.teacher = 'اسم المدرّس أطول من اللازم.';
  if (value.place.length > MAX_COURSE_PLACE) errors.place = 'المكان أطول من اللازم.';
  if (value.startedOn.length > MAX_COURSE_START) errors.startedOn = 'موعد البدء أطول من اللازم.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export async function addCourse(db: Db, adminId: number, input: CourseInput): Promise<number> {
  const [row] = await db.query<{ id: string }>(
    `insert into courses (name, teacher, place, started_on, status, published) values ($1, $2, $3, $4, 'open', $5) returning id`,
    [input.name, input.teacher, input.place || null, input.startedOn || null, input.open],
  );
  const id = Number(row.id);
  await audit(db, adminId, 'course.added', `course:${id}`, { open: input.open });
  return id;
}
