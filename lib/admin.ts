import 'server-only';
import type { Db } from './db';
import { MAX_TEXT, type QuestionKind, type RegistrationStatus, type ShowIf } from './registration';

/**
 * Admin-side data access: registration requests and the registration questionnaire.
 * Callers must have checked the admin session first (see lib/session.ts requireAdmin).
 * Every change is written to audit_log by reference only, never with student names or phones.
 */

async function audit(db: Db, adminId: number, action: string, target: string, detail?: Record<string, unknown>) {
  await db.query('insert into audit_log (admin_id, action, target, detail) values ($1, $2, $3, $4)', [adminId, action, target, detail ? JSON.stringify(detail) : null]);
}

// ---------------------------------------------------------------- registration requests

export type RequestRow = { id: number; studentName: string; birthYear: number; hasGuardian: boolean; course: string; status: RegistrationStatus; createdAt: Date };

export async function listRequests(db: Db, status: RegistrationStatus): Promise<RequestRow[]> {
  const rows = await db.query<{ id: string; full_name: string; birth_year: number; has_guardian: boolean; course: string; status: RegistrationStatus; created_at: Date }>(
    `select r.id, s.full_name, s.birth_year, (s.guardian_consent_at is not null) as has_guardian, c.name as course, r.status, r.created_at
     from registrations r join students s on s.id = r.student_id join courses c on c.id = r.course_id
     where r.status = $1 order by r.created_at desc limit 200`,
    [status]
  );
  return rows.map((r) => ({ id: Number(r.id), studentName: r.full_name, birthYear: r.birth_year, hasGuardian: r.has_guardian, course: r.course, status: r.status, createdAt: new Date(r.created_at) }));
}

export async function countRequests(db: Db): Promise<Record<RegistrationStatus, number>> {
  const rows = await db.query<{ status: RegistrationStatus; n: string }>('select status, count(*) as n from registrations group by status');
  const out: Record<RegistrationStatus, number> = { pending: 0, accepted: 0, rejected: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

export type RequestDetail = RequestRow & {
  phone: string;
  guardianName: string | null;
  guardianPhone: string | null;
  teacher: string;
  adminNote: string | null;
  reviewedAt: Date | null;
  answers: { label: string; answer: string }[];
};

export async function getRequest(db: Db, id: number): Promise<RequestDetail | null> {
  const [r] = await db.query<{
    id: string; full_name: string; birth_year: number; phone: string; guardian_name: string | null; guardian_phone: string | null; has_guardian: boolean;
    course: string; teacher: string; status: RegistrationStatus; admin_note: string | null; created_at: Date; reviewed_at: Date | null;
  }>(
    `select r.id, s.full_name, s.birth_year, s.phone, s.guardian_name, s.guardian_phone, (s.guardian_consent_at is not null) as has_guardian,
            c.name as course, c.teacher, r.status, r.admin_note, r.created_at, r.reviewed_at
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
    answers: answers.map((a) => ({ label: a.label, answer: Array.isArray(a.answer) ? a.answer.join('، ') : String(a.answer) })),
  };
}

/** Accept or reject. A request can be re-decided; rejecting an accepted one revokes access to lessons. */
export async function reviewRequest(db: Db, adminId: number, id: number, decision: 'accepted' | 'rejected', note: string) {
  const adminNote = note.trim().slice(0, MAX_TEXT) || null;
  return db.tx(async (t) => {
    const rows = await t.query<{ status: RegistrationStatus }>(
      'update registrations set status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now() where id = $1 returning status',
      [id, decision, adminNote, adminId]
    );
    if (rows.length === 0) return false;
    await audit(t, adminId, `registration.${decision}`, `registration:${id}`);
    return true;
  });
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

/** Swaps a question with its neighbour above or below. */
export async function moveQuestion(db: Db, adminId: number, id: number, direction: 'up' | 'down') {
  await db.tx(async (t) => {
    const [me] = await t.query<{ id: string; position: number }>('select id, position from form_questions where id = $1', [id]);
    if (!me) return;
    const [other] = await t.query<{ id: string; position: number }>(
      direction === 'up'
        ? 'select id, position from form_questions where position < $1 order by position desc limit 1'
        : 'select id, position from form_questions where position > $1 order by position asc limit 1',
      [me.position]
    );
    if (!other) return;
    await t.query('update form_questions set position = $2 where id = $1', [me.id, other.position]);
    await t.query('update form_questions set position = $2 where id = $1', [other.id, me.position]);
    await audit(t, adminId, 'question.move', `question:${id}`, { direction });
  });
}
