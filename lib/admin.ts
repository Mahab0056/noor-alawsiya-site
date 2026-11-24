import 'server-only';
import type { Db } from './db';
import type { QueueSort } from './queue';
import { courseSeatsOn } from './seats';
import { MAX_TEXT, type QuestionKind, type RegistrationStatus, type ShowIf } from './registration';

/**
 * Admin-side data access: registration requests and the registration questionnaire.
 * Callers must have checked the admin session first (see lib/session.ts requireAdmin).
 * Every change is written to audit_log by reference only, never with student names or phones.
 */

/** adminId null = the operator command (scripts/create-admin.ts), not a signed-in admin. */
export async function audit(db: Db, adminId: number | null, action: string, target: string, detail?: Record<string, unknown>) {
  await db.query('insert into audit_log (admin_id, action, target, detail) values ($1, $2, $3, $4)', [adminId, action, target, detail ? JSON.stringify(detail) : null]);
}

// ---------------------------------------------------------------- registration requests

/** existingStudent: asked for from «حسابي» by a student who already had an account (0007), not with the registration form. */
export type RequestRow = { id: number; studentName: string; birthYear: number; hasGuardian: boolean; course: string; status: RegistrationStatus; createdAt: Date; existingStudent: boolean };

/**
 * One status, optionally one course. Default order: waiting requests oldest first (lib/queue.ts defaultSort), so the
 * request that has waited longest is answered first. The id breaks ties, so the order never changes between loads.
 */
export async function listRequests(
  db: Db,
  status: RegistrationStatus,
  { courseId = null, sort = status === 'pending' ? 'oldest' : 'newest' }: { courseId?: number | null; sort?: QueueSort } = {}
): Promise<RequestRow[]> {
  const order = sort === 'oldest' ? 'r.created_at asc, r.id asc' : 'r.created_at desc, r.id desc';
  const rows = await db.query<{ id: string; full_name: string; birth_year: number; has_guardian: boolean; course: string; status: RegistrationStatus; created_at: Date; origin: string }>(
    `select r.id, s.full_name, s.birth_year, (s.guardian_consent_at is not null) as has_guardian, c.name as course, r.status, r.created_at, r.origin
     from registrations r join students s on s.id = r.student_id join courses c on c.id = r.course_id
     where r.status = $1 and ($2::bigint is null or r.course_id = $2::bigint) order by ${order} limit 200`,
    [status, courseId]
  );
  return rows.map((r) => ({ id: Number(r.id), studentName: r.full_name, birthYear: r.birth_year, hasGuardian: r.has_guardian, course: r.course, status: r.status, createdAt: new Date(r.created_at), existingStudent: r.origin === 'account' }));
}

/** Requests per status, for every course or for one. */
export async function countRequests(db: Db, courseId: number | null = null): Promise<Record<RegistrationStatus, number>> {
  const rows = await db.query<{ status: RegistrationStatus; n: string }>(
    'select status, count(*) as n from registrations where ($1::bigint is null or course_id = $1::bigint) group by status',
    [courseId]
  );
  const out: Record<RegistrationStatus, number> = { pending: 0, accepted: 0, rejected: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

/** When the oldest request still waiting (any course) was sent, or null when none waits. */
export async function oldestPendingAt(db: Db): Promise<Date | null> {
  const [row] = await db.query<{ at: Date | null }>(`select min(created_at) as at from registrations where status = 'pending'`);
  return row?.at ? new Date(row.at) : null;
}

export type CourseFilterOption = { id: number; name: string; pending: number };

/** Courses for the list's course filter: every course that has a request or takes registrations now. */
export async function listCourseFilterOptions(db: Db): Promise<CourseFilterOption[]> {
  const rows = await db.query<{ id: string; name: string; pending: string }>(
    `select c.id, c.name, count(r.id) filter (where r.status = 'pending') as pending
       from courses c left join registrations r on r.course_id = c.id
      group by c.id
     having count(r.id) > 0 or (c.published and c.status = 'open')
      order by count(r.id) filter (where r.status = 'pending') desc, c.name, c.id`
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, pending: Number(r.pending) }));
}

export type RequestDetail = RequestRow & {
  phone: string;
  guardianName: string | null;
  guardianPhone: string | null;
  teacher: string;
  adminNote: string | null;
  reviewedAt: Date | null;
  /** The student's own note, for a request made from «حسابي». */
  studentNote: string | null;
  /** For a minor's request made from «حسابي»: when the guardian's agreement to this request was ticked. */
  requestConsentAt: Date | null;
  answers: { label: string; answer: string }[];
};

export async function getRequest(db: Db, id: number): Promise<RequestDetail | null> {
  const [r] = await db.query<{
    id: string; full_name: string; birth_year: number; phone: string; guardian_name: string | null; guardian_phone: string | null; has_guardian: boolean;
    course: string; teacher: string; status: RegistrationStatus; admin_note: string | null; created_at: Date; reviewed_at: Date | null;
    origin: string; student_note: string | null; request_consent_at: Date | null;
  }>(
    `select r.id, s.full_name, s.birth_year, s.phone, s.guardian_name, s.guardian_phone, (s.guardian_consent_at is not null) as has_guardian,
            c.name as course, c.teacher, r.status, r.admin_note, r.created_at, r.reviewed_at,
            r.origin, r.student_note, r.guardian_consent_at as request_consent_at
     from registrations r join students s on s.id = r.student_id join courses c on c.id = r.course_id
     where r.id = $1`,
    [id]
  );
  if (!r) return null;
  const answers = await db.query<{ label: string; answer: string | string[] }>(
    `select q.label, a.answer from registration_answers a join form_questions q on q.id = a.question_id where a.registration_id = $1 order by q.position, q.id`,
    [id]
  );
  return {
    id: Number(r.id), studentName: r.full_name, birthYear: r.birth_year, hasGuardian: r.has_guardian, course: r.course, status: r.status, createdAt: new Date(r.created_at),
    phone: r.phone, guardianName: r.guardian_name, guardianPhone: r.guardian_phone, teacher: r.teacher, adminNote: r.admin_note,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
    existingStudent: r.origin === 'account', studentNote: r.student_note, requestConsentAt: r.request_consent_at ? new Date(r.request_consent_at) : null,
    answers: answers.map((a) => ({ label: a.label, answer: Array.isArray(a.answer) ? a.answer.join('، ') : String(a.answer) })),
  };
}

export type ReviewResult = 'saved' | 'missing' | 'conflict' | 'full' | 'closed';

/**
 * Accept or reject. A request can be re-decided; rejecting an accepted one revokes access to lessons.
 * 'conflict': accepting an old rejected request while the same student has another pending or accepted request for the
 * same course (allowed since 0007, which lets a rejected course be asked for again). Decide the newer request instead.
 *
 * With COURSE_SEATS on and a seat limit on the course (0015, lib/seats.ts), an accept first locks the course row, so
 * two admins accepting the last seat at once are taken one after the other:
 * - 'full': every seat is already taken by accepted requests; nothing is saved («اكتملت الدورة»).
 * - 'closed': saved, and this accept took the last seat, so registration for the course closed in the same transaction.
 * Reopening is never automatic, also not after a reject frees a seat.
 */
export async function reviewRequest(db: Db, adminId: number, id: number, decision: 'accepted' | 'rejected', note: string, seatsOn = courseSeatsOn()): Promise<ReviewResult> {
  const adminNote = note.trim().slice(0, MAX_TEXT) || null;
  try {
    return await db.tx(async (t) => {
      let fills: number | null = null; // the course id whose last seat this accept takes
      if (seatsOn && decision === 'accepted') {
        const [r] = await t.query<{ course_id: string | number; status: RegistrationStatus }>('select course_id, status from registrations where id = $1', [id]);
        if (!r) return 'missing';
        const [c] = await t.query<{ seats: number | null; published: boolean }>('select seats, published from courses where id = $1 for update', [r.course_id]);
        if (c && c.seats !== null && r.status !== 'accepted') {
          const [{ n }] = await t.query<{ n: string | number }>(`select count(*) as n from registrations where course_id = $1 and status = 'accepted'`, [r.course_id]);
          if (Number(n) >= Number(c.seats)) return 'full';
          if (Number(n) + 1 >= Number(c.seats) && c.published) fills = Number(r.course_id);
        }
      }
      const rows = await t.query<{ id: string }>(
        'update registrations set status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now() where id = $1 returning id',
        [id, decision, adminNote, adminId]
      );
      if (rows.length === 0) return 'missing';
      await audit(t, adminId, `registration.${decision}`, `registration:${id}`);
      if (fills === null) return 'saved';
      await t.query('update courses set published = false where id = $1', [fills]);
      await audit(t, adminId, 'course.closed', `course:${fills}`, { reason: 'full' });
      return 'closed';
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return 'conflict'; // registrations_one_live_idx
    throw e;
  }
}

/**
 * An admin opened «إبلاغ عبر واتساب» for a decided request. The site sends nothing itself, so this records only
 * that the prepared chat was opened: by request id and decision, never the phone number, name or message.
 */
export async function recordNotified(db: Db, adminId: number, id: number) {
  return db.tx(async (t) => {
    const [r] = await t.query<{ status: RegistrationStatus }>('select status from registrations where id = $1', [id]);
    if (!r || r.status === 'pending') return false;
    await audit(t, adminId, 'registration.notified', `registration:${id}`, { decision: r.status });
    return true;
  });
}

/** When «إبلاغ عبر واتساب» was last opened for this request's current decision, or null. */
export async function lastNotifiedAt(db: Db, id: number): Promise<Date | null> {
  const [row] = await db.query<{ at: Date | null }>(
    `select max(a.created_at) as at from audit_log a join registrations r on r.id = $1
     where a.action = 'registration.notified' and a.target = 'registration:' || r.id::text and a.detail->>'decision' = r.status::text`,
    [id]
  );
  return row?.at ? new Date(row.at) : null;
}

// ---------------------------------------------------------------- questionnaire builder

export type QuestionInput = { label: string; kind: QuestionKind; options: string[]; required: boolean; showIf: ShowIf };

export function validateQuestion(input: QuestionInput): string | null {
  const label = input.label.trim();
  if (label.length < 3) return 'اكتب نص السؤال.';
  if (label.length > 200) return 'نص السؤال طويل جداً.';
  if (input.kind === 'single' || input.kind === 'multi') {
    const options = input.options.map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) return 'أضف خيارين على الأقل، كل خيار في سطر.';
    if (options.length > 12) return 'الحد الأقصى ١٢ خياراً.';
    if (new Set(options).size !== options.length) return 'يوجد خيار مكرر.';
    if (options.some((o) => o.length > 80)) return 'أحد الخيارات طويل جداً.';
  }
  return null;
}

const cleanOptions = (input: QuestionInput) => (input.kind === 'single' || input.kind === 'multi' ? input.options.map((o) => o.trim()).filter(Boolean) : []);

export async function addQuestion(db: Db, adminId: number, input: QuestionInput) {
  return db.tx(async (t) => {
    const [{ next }] = await t.query<{ next: number }>('select coalesce(max(position), 0) + 1 as next from form_questions');
    const [row] = await t.query<{ id: string }>('insert into form_questions (label, kind, options, required, position, show_if) values ($1, $2, $3, $4, $5, $6) returning id', [
      input.label.trim(), input.kind, JSON.stringify(cleanOptions(input)), input.required, next, input.showIf ? JSON.stringify(input.showIf) : null,
    ]);
    await audit(t, adminId, 'question.add', `question:${row.id}`);
    return Number(row.id);
  });
}

/** Hides a question from new registrations. Existing answers keep it, so it is never deleted. */
export async function setQuestionActive(db: Db, adminId: number, id: number, active: boolean) {
  await db.tx(async (t) => {
    await t.query('update form_questions set active = $2 where id = $1', [id, active]);
    await audit(t, adminId, active ? 'question.enable' : 'question.disable', `question:${id}`);
  });
}

/** Moves a question one place up or down, then renumbers every position so ties cannot build up. */
export async function moveQuestion(db: Db, adminId: number, id: number, direction: 'up' | 'down') {
  await db.tx(async (t) => {
    const order = (await t.query<{ id: string }>('select id from form_questions order by position, id')).map((r) => Number(r.id));
    const from = order.indexOf(id);
    const to = from + (direction === 'up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    for (const [i, questionId] of order.entries()) await t.query('update form_questions set position = $2 where id = $1', [questionId, i + 1]);
    await audit(t, adminId, 'question.move', `question:${id}`, { direction });
  });
}
