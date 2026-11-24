import 'server-only';
import { audit } from './admin';
import type { Db } from './db';
import { isMinorIn } from './form-rules';

/**
 * «كشف الدورة»: the accepted students of one course, for the teacher's paper list on the first class.
 *
 * Read only, print only. There is no CSV, no PDF and no route that returns the list as a file: the list exists as an
 * admin page and, once printed, as paper at the school. Every open of the page writes one audit_log row
 * ('course.roster_viewed', target course:<id>, the admin, the time). As everywhere in audit_log, no names or phones.
 *
 * Callers must have checked the admin session first (lib/session.ts requireAdmin), the same role as for requests.
 * Not related to PROGRESS_TRACKING (lesson progress): this reads registrations only.
 */

export type AgeGroup = 'minor' | 'adult';
export const AGE_GROUP_LABEL: Record<AgeGroup, string> = { minor: 'قاصر', adult: 'بالغ' };

export type RosterRow = { studentName: string; ageGroup: AgeGroup; guardianName: string | null; guardianPhone: string | null };
export type Roster = { courseId: number; courseName: string; teacher: string | null; students: RosterRow[] };

const BY_NAME = new Intl.Collator('ar', { sensitivity: 'base', numeric: true });

/** null = no such course. thisYear decides «قاصر»/«بالغ» with the site's own rule (lib/form-rules.ts isMinorIn). */
export async function getRoster(db: Db, courseId: number, thisYear = new Date().getFullYear()): Promise<Roster | null> {
  const [course] = await db.query<{ id: string; name: string; teacher: string | null }>('select id, name, teacher from courses where id = $1', [courseId]);
  if (!course) return null;
  const rows = await db.query<{ id: string; full_name: string; birth_year: number; guardian_name: string | null; guardian_phone: string | null }>(
    `select r.id, s.full_name, s.birth_year, s.guardian_name, s.guardian_phone
       from registrations r join students s on s.id = r.student_id
      where r.course_id = $1 and r.status = 'accepted'`,
    [courseId]
  );
  const students = rows
    .map((r) => ({ id: Number(r.id), row: {
      studentName: r.full_name,
      ageGroup: (isMinorIn(r.birth_year, thisYear) ? 'minor' : 'adult') as AgeGroup,
      guardianName: r.guardian_name?.trim() || null,
      guardianPhone: r.guardian_phone?.trim() || null,
    } }))
    .sort((a, b) => BY_NAME.compare(a.row.studentName, b.row.studentName) || a.id - b.id)
    .map((s) => s.row);
  const teacher = course.teacher?.trim() || null;
  return { courseId: Number(course.id), courseName: course.name, teacher, students };
}

/** One row per open, also when the list is empty. Not written for a course that does not exist. */
export async function recordRosterView(db: Db, adminId: number, courseId: number) {
  await audit(db, adminId, 'course.roster_viewed', `course:${courseId}`);
}

/** The «حضور» column: empty boxes the teacher ticks by hand. */
export const ATTENDANCE_BOXES = 8;
