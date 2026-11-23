import 'server-only';
import type { Db } from './db';
import { COURSES } from './data';
import { courseBySlug } from './share';

/**
 * The accepted course a signed-in student may open the welcome page for. `studentId` must come from the session.
 * Returns null (the page answers 404) for an unknown slug, a request that is pending or rejected, and another student's course:
 * the query only ever reads this student's own accepted requests.
 */
export async function acceptedWelcomeCourse(db: Db, studentId: number, slug: string): Promise<{ course: string; place: string | null } | null> {
  const record = courseBySlug(slug);
  if (!record) return null;
  const [row] = await db.query<{ name: string; place: string | null }>(
    `select c.name, c.place from registrations r join courses c on c.id = r.course_id
     where r.student_id = $1 and r.status = 'accepted' and c.name = $2 limit 1`,
    [studentId, record.name]
  );
  return row ? { course: row.name, place: row.place ?? COURSES.find((c) => c.name === row.name)?.place ?? null } : null;
}
