import 'server-only';
import { audit } from './admin';
import type { Db } from './db';
import type { AdminRole } from './invites';

/**
 * «المتابعة», the simplest kind from awsiya-progress-design-2011r: «حضور وملاحظة».
 * A session is one course on one Baghdad date. For each accepted pupil the recorder marks present / absent / excused and
 * may write one short note that the pupil's account («حسابي», read by the guardian for a minor) shows.
 *
 * Who may record for a course: a super admin for any course; any other active admin (role «أستاذ» or a staff member)
 * only for a course they are assigned to in course_teachers. A teacher may record or correct from Saturday of the
 * current Baghdad week up to today; a super admin any day up to today, within a year. Nobody records a future day.
 *
 * Every function here checks the actor against the database itself, whatever the page or action already checked.
 * The audit log gets ids and counts only: no pupil names, no note text.
 * The feature flag (lib/flags.ts progressEnabled) is checked by the pages and actions, not here, so tests run either way.
 */

export type AttendanceStatus = 'present' | 'absent' | 'excused';
export const ATTENDANCE: AttendanceStatus[] = ['present', 'absent', 'excused'];
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { present: 'حاضر', absent: 'غائب', excused: 'مجاز' };
/** Absence is amber, never red (design §4): it is stated, not punished. */
export const ATTENDANCE_TAG: Record<AttendanceStatus, string> = { present: 'ok', absent: 'warn', excused: '' };
export const MAX_NOTE = 300;
const MAX_ROSTER = 200;
const MAX_BACK_DAYS = 366;

/** Roles that may sign in to the admin panel's other screens. A teacher sees only «الحضور». */
export const isTeacherRole = (role: AdminRole) => role === 'teacher';

const DIGITS = new Intl.NumberFormat('ar-EG', { useGrouping: false });
/** Which form a counted noun takes after n (n ≥ 3): 3–10 plural, 11–99 singular accusative, otherwise singular. */
const countForm = (n: number) => {
  const r = n % 100;
  return r >= 3 && r <= 10 ? 'plural' : r >= 11 ? 'acc' : 'one';
};
/** «طالب واحد» / «طالبان» / «٣ طلاب» / «١١ طالباً» / «١٠٠ طالب»: the counted noun agrees with the number. */
export const pupilsText = (n: number) =>
  n === 1 ? 'طالب واحد' : n === 2 ? 'طالبان' : `${DIGITS.format(n)} ${{ plural: 'طلاب', acc: 'طالباً', one: 'طالب' }[countForm(n)]}`;
/** The roster heading: «طالب واحد مقبول» / «طالبان مقبولان» / «٦ طلاب مقبولون» / «١١ طالباً مقبولاً». */
export const acceptedText = (n: number) =>
  n === 1 ? 'طالب واحد مقبول' : n === 2 ? 'طالبان مقبولان' : `${pupilsText(n)} ${{ plural: 'مقبولون', acc: 'مقبولاً', one: 'مقبول' }[countForm(n)]}`;
/** «حسابي»: «حضور مريم: ١ من حلقتين مسجّلتين.» No verb, so nothing to get wrong for a girl's name. */
export const attendedText = (firstName: string, present: number, total: number) => {
  const of = total === 1 ? 'حلقة واحدة مسجّلة' : total === 2 ? 'حلقتين مسجّلتين'
    : `${DIGITS.format(total)} ${{ plural: 'حلقات مسجّلة', acc: 'حلقة مسجّلة', one: 'حلقة مسجّلة' }[countForm(total)]}`;
  return `حضور ${firstName}: ${DIGITS.format(present)} من ${of}.`;
};

// ---------------------------------------------------------------- Baghdad dates (YYYY-MM-DD)

const YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' });
export const baghdadToday = (now = new Date()) => YMD.format(now);

export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Saturday on or before `day` (the school week runs Saturday to Friday). */
export const weekStart = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 1) % 7));

/** The earliest day this recorder may still write, given today in Baghdad. */
export const earliestDay = (isSuper: boolean, today: string) => (isSuper ? addDays(today, -MAX_BACK_DAYS) : weekStart(today));

const DAY_LABEL = new Intl.DateTimeFormat('ar-IQ-u-nu-arab-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_LABEL_Y = new Intl.DateTimeFormat('ar-IQ-u-nu-arab-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** «الأحد ٢٢ تشرين الثاني»; with the year when it is not the current one. */
export const formatDay = (day: string, today = baghdadToday()) => (day.slice(0, 4) === today.slice(0, 4) ? DAY_LABEL : DAY_LABEL_Y).format(new Date(`${day}T00:00:00Z`));

// ---------------------------------------------------------------- who may record

export type Access = { isSuper: boolean };

/** null = this admin may not record for this course (inactive, not assigned, or no such course). */
export async function recordAccess(db: Db, adminId: number, courseId: number): Promise<Access | null> {
  const [r] = await db.query<{ is_super: boolean; assigned: boolean; course: boolean }>(
    `select a.role = 'super_admin' as is_super,
            exists (select 1 from course_teachers t where t.course_id = $2 and t.admin_id = a.id) as assigned,
            exists (select 1 from courses c where c.id = $2) as course
       from admins a where a.id = $1 and a.activated_at is not null and a.disabled_at is null`,
    [adminId, courseId]
  );
  if (!r?.course || !(r.is_super || r.assigned)) return null;
  return { isSuper: r.is_super };
}

async function isActiveSuper(db: Db, adminId: number) {
  const [r] = await db.query<{ ok: boolean }>(`select (role = 'super_admin' and activated_at is not null and disabled_at is null) as ok from admins where id = $1`, [adminId]);
  return r?.ok === true;
}

export type RecordableCourse = { id: number; name: string; teacher: string; done: boolean; pupils: number; sessions: number; lastOn: string | null };

/** The courses this admin may record for: every course for a super admin, the assigned ones for anyone else. */
export async function listRecordableCourses(db: Db, adminId: number): Promise<RecordableCourse[]> {
  const isSuper = await isActiveSuper(db, adminId);
  const rows = await db.query<{ id: string; name: string; teacher: string; status: string; pupils: string; sessions: string; last_on: string | null }>(
    `select c.id, c.name, c.teacher, c.status,
            (select count(*) from enrollments e where e.course_id = c.id) as pupils,
            (select count(*) from class_sessions s where s.course_id = c.id) as sessions,
            (select max(s.held_on)::text from class_sessions s where s.course_id = c.id) as last_on
       from courses c
      where $2::boolean or exists (select 1 from course_teachers t join admins a on a.id = t.admin_id
                                    where t.course_id = c.id and t.admin_id = $1 and a.activated_at is not null and a.disabled_at is null)
      order by (c.status = 'done'), pupils desc, c.id desc`,
    [adminId, isSuper]
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, teacher: r.teacher, done: r.status === 'done', pupils: Number(r.pupils), sessions: Number(r.sessions), lastOn: r.last_on }));
}

export async function getCourseName(db: Db, courseId: number) {
  const [r] = await db.query<{ name: string; teacher: string }>('select name, teacher from courses where id = $1', [courseId]);
  return r ?? null;
}

// ---------------------------------------------------------------- the roster of one session

/** Name only: a teacher never sees a phone, a birth year or the questionnaire answers. */
export type RosterRow = { studentId: number; name: string; status: AttendanceStatus | null; note: string | null };
export type Roster = { sessionId: number | null; rows: RosterRow[] };

/** Accepted pupils of the course with what is recorded for `day`. null when this admin may not record here. */
export async function getRoster(db: Db, adminId: number, courseId: number, day: string): Promise<Roster | null> {
  if (!isDay(day) || !(await recordAccess(db, adminId, courseId))) return null;
  const [session] = await db.query<{ id: string }>('select id from class_sessions where course_id = $1 and held_on = $2::date', [courseId, day]);
  const sessionId = session ? Number(session.id) : null;
  const rows = await db.query<{ id: string; full_name: string; status: AttendanceStatus | null; note: string | null }>(
    `select s.id, s.full_name, a.status, a.note
       from enrollments e join students s on s.id = e.student_id
       left join session_attendance a on a.session_id = $2 and a.student_id = s.id
      where e.course_id = $1
      order by s.full_name, s.id
      limit ${MAX_ROSTER}`,
    [courseId, sessionId ?? 0]
  );
  return { sessionId, rows: rows.map((r) => ({ studentId: Number(r.id), name: r.full_name, status: r.status, note: r.note })) };
}

export type SessionRow = { id: number; day: string; present: number; absent: number; excused: number };

export async function listSessions(db: Db, adminId: number, courseId: number, limit = 30): Promise<SessionRow[]> {
  if (!(await recordAccess(db, adminId, courseId))) return [];
  const rows = await db.query<{ id: string; held_on: string; present: string; absent: string; excused: string }>(
    `select s.id, s.held_on::text as held_on,
            count(a.student_id) filter (where a.status = 'present') as present,
            count(a.student_id) filter (where a.status = 'absent') as absent,
            count(a.student_id) filter (where a.status = 'excused') as excused
       from class_sessions s left join session_attendance a on a.session_id = s.id
      where s.course_id = $1
      group by s.id order by s.held_on desc limit $2`,
    [courseId, limit]
  );
  return rows.map((r) => ({ id: Number(r.id), day: r.held_on, present: Number(r.present), absent: Number(r.absent), excused: Number(r.excused) }));
}

// ---------------------------------------------------------------- saving

export type EntryInput = { studentId: unknown; status: unknown; note: unknown };
export type SaveFailure = 'forbidden' | 'bad-date' | 'future' | 'locked' | 'empty' | 'bad-input' | 'note-long' | 'not-enrolled';
export type SaveResult = { ok: true; sessionId: number; present: number; absent: number; excused: number; changed: number } | { ok: false; reason: SaveFailure; studentId?: number };

/** One line, trimmed; '' becomes null. */
export const cleanNote = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '') || null;

/**
 * Saves the attendance of one course on one day. The whole save is refused if any pupil in it is not an accepted pupil
 * of this course (another course's pupil, a pending or a rejected request, or a made-up id): nothing is written then.
 * Pupils left out of `entries` are not touched.
 */
export async function saveAttendance(db: Db, adminId: number, courseId: number, day: unknown, entries: EntryInput[], now = new Date()): Promise<SaveResult> {
  const access = await recordAccess(db, adminId, courseId);
  if (!access) return { ok: false, reason: 'forbidden' };
  if (!isDay(day)) return { ok: false, reason: 'bad-date' };
  const today = baghdadToday(now);
  if (day > today) return { ok: false, reason: 'future' };
  if (day < earliestDay(access.isSuper, today)) return { ok: false, reason: access.isSuper ? 'bad-date' : 'locked' };
  if (entries.length === 0) return { ok: false, reason: 'empty' };
  if (entries.length > MAX_ROSTER) return { ok: false, reason: 'bad-input' };

  const clean: { studentId: number; status: AttendanceStatus; note: string | null }[] = [];
  const seen = new Set<number>();
  for (const e of entries) {
    const studentId = typeof e.studentId === 'number' ? e.studentId : Number(e.studentId);
    const status = ATTENDANCE.find((s) => s === e.status);
    if (!Number.isSafeInteger(studentId) || studentId <= 0 || !status || seen.has(studentId)) return { ok: false, reason: 'bad-input' };
    seen.add(studentId);
    const note = cleanNote(e.note);
    if (note && note.length > MAX_NOTE) return { ok: false, reason: 'note-long', studentId };
    clean.push({ studentId, status, note });
  }

  return db.tx(async (t) => {
    const enrolled = new Set((await t.query<{ student_id: string }>('select student_id from enrollments where course_id = $1', [courseId])).map((r) => Number(r.student_id)));
    const stranger = clean.find((c) => !enrolled.has(c.studentId));
    if (stranger) return { ok: false, reason: 'not-enrolled' } as const;

    await t.query('insert into class_sessions (course_id, held_on, created_by) values ($1, $2::date, $3) on conflict (course_id, held_on) do nothing', [courseId, day, adminId]);
    const [{ id }] = await t.query<{ id: string }>('select id from class_sessions where course_id = $1 and held_on = $2::date', [courseId, day]);
    const sessionId = Number(id);
    const before = new Map((await t.query<{ student_id: string; status: AttendanceStatus; note: string | null }>('select student_id, status, note from session_attendance where session_id = $1', [sessionId])).map((r) => [Number(r.student_id), r]));

    let changed = 0;
    const counts = { present: 0, absent: 0, excused: 0 };
    // Ids of the pupils whose row this save wrote, so an edit to a note a guardian may have read can be traced to
    // the pupil and the admin. Ids only, as everywhere in the audit log.
    const written: number[] = [];
    for (const c of clean) {
      counts[c.status]++;
      const old = before.get(c.studentId);
      if (old && old.status === c.status && old.note === c.note) continue;
      if (old) changed++;
      written.push(c.studentId);
      await t.query(
        `insert into session_attendance (session_id, student_id, status, note, recorded_by) values ($1, $2, $3, $4, $5)
         on conflict (session_id, student_id) do update set status = excluded.status, note = excluded.note, recorded_by = excluded.recorded_by, updated_at = now()`,
        [sessionId, c.studentId, c.status, c.note, adminId]
      );
    }
    written.sort((a, b) => a - b);
    await audit(t, adminId, before.size ? 'attendance.edit' : 'attendance.save', `session:${sessionId}`, { ...counts, changed, students: written });
    return { ok: true, sessionId, ...counts, changed } as const;
  });
}

/** Super admin only: removes a session recorded on the wrong day, with its rows. */
export async function deleteSession(db: Db, adminId: number, courseId: number, day: unknown): Promise<'deleted' | 'forbidden' | 'missing'> {
  if (!(await isActiveSuper(db, adminId))) return 'forbidden';
  if (!isDay(day)) return 'missing';
  return db.tx(async (t) => {
    const [row] = await t.query<{ id: string; rows: string }>(
      `select s.id, (select count(*) from session_attendance a where a.session_id = s.id) as rows from class_sessions s where s.course_id = $1 and s.held_on = $2::date`,
      [courseId, day]
    );
    if (!row) return 'missing';
    await t.query('delete from class_sessions where id = $1', [row.id]);
    await audit(t, adminId, 'attendance.delete', `session:${row.id}`, { course: courseId, rows: Number(row.rows) });
    return 'deleted';
  });
}

// ---------------------------------------------------------------- assigning recorders to a course (super admin)

export type CourseRecorder = { adminId: number; name: string; email: string; role: AdminRole };

export async function listCourseRecorders(db: Db, courseId: number): Promise<CourseRecorder[]> {
  const rows = await db.query<{ id: string; name: string; email: string; role: AdminRole }>(
    `select a.id, a.name, a.email, a.role from course_teachers t join admins a on a.id = t.admin_id where t.course_id = $1 order by a.name, a.id`,
    [courseId]
  );
  return rows.map((r) => ({ adminId: Number(r.id), name: r.name, email: r.email, role: r.role }));
}

/** Active admins who are not super admins (those record everywhere already). */
export async function listAssignable(db: Db): Promise<CourseRecorder[]> {
  const rows = await db.query<{ id: string; name: string; email: string; role: AdminRole }>(
    `select id, name, email, role from admins where role <> 'super_admin' and activated_at is not null and disabled_at is null order by (role = 'teacher') desc, name, id`
  );
  return rows.map((r) => ({ adminId: Number(r.id), name: r.name, email: r.email, role: r.role }));
}

export type AssignResult = 'saved' | 'forbidden' | 'missing';

export async function setCourseRecorder(db: Db, actorId: number, courseId: number, adminId: number, on: boolean): Promise<AssignResult> {
  if (!(await isActiveSuper(db, actorId))) return 'forbidden';
  return db.tx(async (t) => {
    const [ok] = await t.query<{ course: boolean; admin: boolean }>(
      `select exists (select 1 from courses where id = $1) as course,
              exists (select 1 from admins where id = $2 and role <> 'super_admin' and activated_at is not null and disabled_at is null) as admin`,
      [courseId, adminId]
    );
    if (on && !(ok.course && ok.admin)) return 'missing';
    const rows = on
      ? await t.query('insert into course_teachers (course_id, admin_id, added_by) values ($1, $2, $3) on conflict do nothing returning admin_id', [courseId, adminId, actorId])
      : await t.query('delete from course_teachers where course_id = $1 and admin_id = $2 returning admin_id', [courseId, adminId]);
    if (rows.length) await audit(t, actorId, on ? 'course.teacher.add' : 'course.teacher.remove', `course:${courseId}`, { admin: adminId });
    return 'saved';
  });
}

// ---------------------------------------------------------------- «حسابي»: what the pupil / guardian sees

export type PupilSession = { day: string; status: AttendanceStatus; note: string | null };
export type PupilCourse = { courseId: number; course: string; teacher: string; present: number; absent: number; excused: number; sessions: PupilSession[] };

/**
 * For each course this pupil is accepted in: their own attendance rows, newest first (at most `limit` shown, counted
 * over all). Read through the accepted-requests view, so rejecting a request hides its course at once. Never another
 * pupil's row, never a rank, never who edited.
 */
export async function pupilProgress(db: Db, studentId: number, limit = 20): Promise<PupilCourse[]> {
  const courses = await db.query<{ id: string; name: string; teacher: string }>(
    `select c.id, c.name, c.teacher from enrollments e join courses c on c.id = e.course_id where e.student_id = $1 order by e.enrolled_at desc nulls last, c.id desc`,
    [studentId]
  );
  if (courses.length === 0) return [];
  const rows = await db.query<{ course_id: string; held_on: string; status: AttendanceStatus; note: string | null }>(
    `select s.course_id, s.held_on::text as held_on, a.status, a.note
       from session_attendance a
       join class_sessions s on s.id = a.session_id
       join enrollments e on e.course_id = s.course_id and e.student_id = a.student_id
      where a.student_id = $1
      order by s.held_on desc`,
    [studentId]
  );
  return courses.map((c) => {
    const mine = rows.filter((r) => Number(r.course_id) === Number(c.id));
    const count = (s: AttendanceStatus) => mine.filter((r) => r.status === s).length;
    return {
      courseId: Number(c.id), course: c.name, teacher: c.teacher,
      present: count('present'), absent: count('absent'), excused: count('excused'),
      sessions: mine.slice(0, limit).map((r) => ({ day: r.held_on, status: r.status, note: r.note })),
    };
  });
}
