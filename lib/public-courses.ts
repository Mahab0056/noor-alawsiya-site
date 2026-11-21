import type { Course, CourseKind } from './data';
import type { Db } from './db';

/**
 * The public pages (home, /courses) show the school record (lib/data.ts). The record's 'open' means «still running»,
 * not «takes new students»: that is decided per course in the admin «الدورات» screen (published + status 'open').
 *
 * This file joins the two. Record entries are matched to database rows by name (the seed inserts the record's names).
 * Published database rows that match no record entry were added in the panel: /courses lists them as «دورات جديدة».
 *
 * `null` everywhere below means «the database could not be read»: the pages then show the record alone, with no
 * registration badges, and never fail.
 */

export type DbCourseRow = { id: number; name: string; kind: CourseKind | null; description: string | null; teacher: string; place: string | null; startedOn: string | null; status: Course['status']; accepting: boolean };

export type PublicCourses = {
  /** Record course name → database id, for the courses that take registrations now. */
  openByName: Record<string, number>;
  /** Published database courses that are not in the record (added in the panel). */
  extra: (Course & { id: number; accepting: boolean })[];
  /** Every course that takes registrations now, record or new, for the JSON-LD and the counts. */
  open: { id: number; name: string; description: string | null }[];
};

/** Names compare after trimming and collapsing spaces, so a stray space in the panel still matches. */
export const nameKey = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Only published rows leave the database: an unpublished course is never shown to the public. */
export async function readPublishedCourses(db: Db): Promise<DbCourseRow[]> {
  const rows = await db.query<{ id: string | number; name: string; kind: CourseKind | null; description: string | null; teacher: string; place: string | null; started_on: string | null; status: Course['status'] }>(
    `select id, name, kind, description, teacher, place, started_on, status from courses where published order by id`,
  );
  return rows.map((r) => ({
    id: Number(r.id), name: r.name, kind: r.kind, description: r.description, teacher: r.teacher, place: r.place,
    startedOn: r.started_on, status: r.status, accepting: r.status === 'open',
  }));
}

export function matchCourses(record: Course[], rows: DbCourseRow[]): PublicCourses {
  const recordNames = new Set(record.map((c) => nameKey(c.name)));
  const openByName: Record<string, number> = {};
  const open: PublicCourses['open'] = [];
  const extra: PublicCourses['extra'] = [];
  for (const r of rows) {
    const key = nameKey(r.name);
    if (recordNames.has(key)) {
      // Two rows with one name (should not happen): the first open one wins, so the link always reaches an open course.
      if (r.accepting && openByName[key] === undefined) {
        const rec = record.find((c) => nameKey(c.name) === key)!;
        openByName[rec.name] = r.id;
        open.push({ id: r.id, name: rec.name, description: rec.kindLabel });
      }
      continue;
    }
    extra.push({
      id: r.id, accepting: r.accepting, name: key, kind: r.kind, kindLabel: r.description, teacher: r.teacher,
      place: r.place, start: r.startedOn, status: r.status, note: null, graduates: null,
    });
    if (r.accepting) open.push({ id: r.id, name: key, description: r.description });
  }
  // Open new courses first, then the rest, newest first.
  extra.sort((a, b) => Number(b.accepting) - Number(a.accepting) || b.id - a.id);
  return { openByName, extra, open };
}

/** The six home cards: courses that take registrations first (in record order), then the usual picks. */
export function homeCourses(record: Course[], picks: Course[], data: PublicCourses | null, size = 6): Course[] {
  const first = data ? record.filter((c) => data.openByName[c.name] !== undefined) : [];
  const out = [...first];
  for (const c of picks) if (!out.includes(c)) out.push(c);
  return out.slice(0, size);
}

/** «دورة واحدة»، «دورتين»، «٣ دورات»، «١١ دورة». */
export function coursesCount(n: number) {
  if (n === 1) return 'دورة واحدة';
  if (n === 2) return 'دورتين';
  const digits = new Intl.NumberFormat('ar-EG', { useGrouping: false }).format(n);
  return `${digits} ${n >= 3 && n <= 10 ? 'دورات' : 'دورة'}`;
}
