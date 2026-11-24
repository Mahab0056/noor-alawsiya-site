import 'server-only';
import { audit } from './admin';
import type { Db } from './db';
import { courseSeatsOn, parseSeats } from './seats';

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
export type AdminCourse = { id: number; name: string; teacher: string; place: string | null; startedOn: string | null; status: CourseStatus; accepting: boolean; pending: number; accepted: number; seats: number | null };

export async function listCoursesForAdmin(db: Db): Promise<AdminCourse[]> {
  const rows = await db.query<{ id: string; name: string; teacher: string; place: string | null; started_on: string | null; status: CourseStatus; published: boolean; seats: number | null; pending: string; accepted: string }>(
    `select c.id, c.name, c.teacher, c.place, c.started_on, c.status, c.published, c.seats,
            count(r.id) filter (where r.status = 'pending') as pending,
            count(r.id) filter (where r.status = 'accepted') as accepted
       from courses c left join registrations r on r.course_id = c.id
      group by c.id
      order by (c.published and c.status = 'open') desc, (c.status = 'done'), c.id desc`,
  );
  return rows.map((r) => ({
    id: Number(r.id), name: r.name, teacher: r.teacher, place: r.place, startedOn: r.started_on, status: r.status,
    accepting: r.published && r.status === 'open', pending: Number(r.pending), accepted: Number(r.accepted), seats: r.seats === null ? null : Number(r.seats),
  }));
}

export type OpenResult = 'saved' | 'missing' | 'done' | 'full';

/**
 * open = take new registrations; closed = hidden from the form. Requests already sent stay as they are.
 * With COURSE_SEATS on, a course whose seats are all taken by accepted requests cannot be opened ('full'): raise the
 * number or free a seat first. That keeps «open» meaning «there is a place for you».
 */
export async function setCourseAccepting(db: Db, adminId: number, courseId: number, open: boolean, seatsOn = courseSeatsOn()): Promise<OpenResult> {
  return db.tx(async (t) => {
    // The same row lock as an accept (lib/admin.ts reviewRequest), so «open» never slips past the accept that filled it.
    const [row] = await t.query<{ status: CourseStatus; seats: number | null }>('select status, seats from courses where id = $1 for update', [courseId]);
    if (!row) return 'missing';
    if (open && row.status === 'done') return 'done';
    if (open && seatsOn && row.seats !== null) {
      const [{ n }] = await t.query<{ n: string | number }>(`select count(*) as n from registrations where course_id = $1 and status = 'accepted'`, [courseId]);
      if (Number(n) >= Number(row.seats)) return 'full';
    }
    if (open) await t.query(`update courses set published = true, status = 'open' where id = $1`, [courseId]);
    else await t.query('update courses set published = false where id = $1', [courseId]);
    await audit(t, adminId, open ? 'course.opened' : 'course.closed', `course:${courseId}`);
    return 'saved';
  });
}

export type SeatsResult = 'saved' | 'missing' | 'closed';

/**
 * Set or clear «عدد المقاعد». If the new number is already taken by accepted requests, registration closes in the
 * same transaction ('closed'). Clearing it, or raising it, never reopens a course: that stays a manual action.
 * The course row is locked, the same lock an accept takes, so a number and an accept never cross.
 */
export async function setCourseSeats(db: Db, adminId: number, courseId: number, seats: number | null): Promise<SeatsResult> {
  return db.tx(async (t) => {
    const [row] = await t.query<{ published: boolean }>('select published from courses where id = $1 for update', [courseId]);
    if (!row) return 'missing';
    await t.query('update courses set seats = $2 where id = $1', [courseId, seats]);
    await audit(t, adminId, 'course.seats', `course:${courseId}`, { seats });
    if (seats === null || !row.published) return 'saved';
    const [{ n }] = await t.query<{ n: string | number }>(`select count(*) as n from registrations where course_id = $1 and status = 'accepted'`, [courseId]);
    if (Number(n) < seats) return 'saved';
    await t.query('update courses set published = false where id = $1', [courseId]);
    await audit(t, adminId, 'course.closed', `course:${courseId}`, { reason: 'full' });
    return 'closed';
  });
}

export const MAX_COURSE_NAME = 120;
export const MAX_COURSE_TEACHER = 120;
export const MAX_COURSE_PLACE = 160;
export const MAX_COURSE_START = 60;

/** seats: «عدد المقاعد» as typed (COURSE_SEATS only; left out = no limit). */
export type CourseInput = { name: string; teacher: string; place: string; startedOn: string; open: boolean; seats?: string };
export type CourseValue = Omit<CourseInput, 'seats'> & { seats?: number | null };
export type CourseErrors = Partial<Record<'name' | 'teacher' | 'place' | 'startedOn' | 'seats', string>>;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function validateCourse(input: CourseInput): { ok: true; value: CourseValue } | { ok: false; errors: CourseErrors } {
  const value: CourseValue = { name: clean(input.name), teacher: clean(input.teacher), place: clean(input.place), startedOn: clean(input.startedOn), open: input.open };
  const errors: CourseErrors = {};
  if (value.name.length < 3) errors.name = 'اكتب اسم الدورة (٣ أحرف على الأقل).';
  else if (value.name.length > MAX_COURSE_NAME) errors.name = 'اسم الدورة أطول من اللازم.';
  if (value.teacher.length < 3) errors.teacher = 'اكتب اسم المدرّس (٣ أحرف على الأقل).';
  else if (value.teacher.length > MAX_COURSE_TEACHER) errors.teacher = 'اسم المدرّس أطول من اللازم.';
  if (value.place.length > MAX_COURSE_PLACE) errors.place = 'المكان أطول من اللازم.';
  if (value.startedOn.length > MAX_COURSE_START) errors.startedOn = 'موعد البدء أطول من اللازم.';
  if (input.seats !== undefined) {
    const seats = parseSeats(input.seats);
    if (seats.ok) value.seats = seats.value;
    else errors.seats = seats.error;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export async function addCourse(db: Db, adminId: number, input: CourseValue): Promise<number> {
  const withSeats = input.seats !== undefined && input.seats !== null;
  const [row] = await db.query<{ id: string }>(
    withSeats
      ? `insert into courses (name, teacher, place, started_on, status, published, seats) values ($1, $2, $3, $4, 'open', $5, $6) returning id`
      : `insert into courses (name, teacher, place, started_on, status, published) values ($1, $2, $3, $4, 'open', $5) returning id`,
    withSeats ? [input.name, input.teacher, input.place || null, input.startedOn || null, input.open, input.seats] : [input.name, input.teacher, input.place || null, input.startedOn || null, input.open],
  );
  const id = Number(row.id);
  await audit(db, adminId, 'course.added', `course:${id}`, withSeats ? { open: input.open, seats: input.seats } : { open: input.open });
  return id;
}
