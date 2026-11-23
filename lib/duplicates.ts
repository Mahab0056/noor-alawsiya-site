import 'server-only';
import type { Db } from './db';
import { normalizePhone } from './form-rules';
import type { RegistrationStatus } from './registration';

/**
 * «يمكن مكرر»: worried families send the registration form again when they hear nothing, and each copy would then
 * wait in the queue and might get two answers from two admins. This only points the copies out; nothing is merged or
 * deleted automatically, and nothing is sent to anyone.
 *
 * A request is a likely copy of another one when, for the SAME course, a different student row has
 *   - the same phone: the guardian's phone, or the student's own (an adult has no guardian; and one family may type the
 *     parent's number as the student's phone once and as the guardian's the next time), or
 *   - the same name (spelling-normalised, see normalizeName) and the same birth year.
 * The other request counts while it is open (pending) or, whatever its status, sent in the last 30 days. Requests
 * already closed as copies never count, so closing one copy cannot make the original look like a copy of it.
 * The same student asking for the same course again after a rejection is allowed since 0007 and is not a copy.
 *
 * Behind DUPLICATE_HINTS (env), default off. Off: no badge, no «اعتبره مكرر», the usual thank-you text.
 */

export const DUPLICATE_WINDOW_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** On only for an explicit 1 / true / on. Anything else, or unset, is off. */
export function duplicateHintsOn(env: Record<string, string | undefined> = process.env) {
  return /^(1|true|on)$/i.test(env.DUPLICATE_HINTS?.trim() ?? '');
}

/**
 * The same name typed twice by a parent on a phone: Arabic spelling variants that are the same name to a person.
 * Hamza forms of alif, taa marbuta/haa, alif maqsura/yaa, tatweel, harakat and extra spaces. Persian kaf/yeh as Arabic.
 */
export function normalizeName(name: string) {
  return name
    .normalize('NFC')
    .replace(/[ً-ٰٟـ]/g, '') // harakat, superscript alif, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every phone a request reaches the family on, normalised with the form's own rule (Arabic digits, +964 / 0). */
export function familyPhones(phone: string | null | undefined, guardianPhone: string | null | undefined): string[] {
  return [...new Set([phone, guardianPhone].map((p) => (p ? normalizePhone(p) : null)).filter((p): p is string => p !== null))];
}

export type HintReason = 'phone' | 'name';
export type DuplicateHint = { id: number; studentName: string; status: RegistrationStatus; createdAt: Date; reasons: HintReason[] };

type Candidate = {
  id: number;
  studentId: number;
  courseId: number;
  status: RegistrationStatus;
  createdAt: Date;
  studentName: string;
  name: string;
  birthYear: number;
  phones: string[];
};

type CandidateRow = { id: string; student_id: string; course_id: string; status: RegistrationStatus; created_at: Date; full_name: string; birth_year: number; phone: string; guardian_phone: string | null };

const toCandidate = (r: CandidateRow): Candidate => ({
  id: Number(r.id),
  studentId: Number(r.student_id),
  courseId: Number(r.course_id),
  status: r.status,
  createdAt: new Date(r.created_at),
  studentName: r.full_name,
  name: normalizeName(r.full_name),
  birthYear: Number(r.birth_year),
  phones: familyPhones(r.phone, r.guardian_phone),
});

const SELECT = `select r.id, r.student_id, r.course_id, r.status, r.created_at, s.full_name, s.birth_year, s.phone, s.guardian_phone
                  from registrations r join students s on s.id = r.student_id`;

/** Why `b` looks like a copy of `a`, or an empty list. Pure, so the rules are tested without a database. */
export function hintReasons(a: Omit<Candidate, 'id' | 'status' | 'createdAt' | 'studentName'>, b: Omit<Candidate, 'id' | 'status' | 'createdAt' | 'studentName'>): HintReason[] {
  if (a.courseId !== b.courseId || a.studentId === b.studentId) return [];
  const reasons: HintReason[] = [];
  if (a.phones.some((p) => b.phones.includes(p))) reasons.push('phone');
  if (a.name && a.name === b.name && a.birthYear === b.birthYear) reasons.push('name');
  return reasons;
}

/** Whether a request still counts as the «other» one: open, or sent within the window. Closed copies never count. */
export const countsAsOther = (c: { status: RegistrationStatus; createdAt: Date }, now: Date) =>
  c.status !== 'duplicate' && (c.status === 'pending' || now.getTime() - c.createdAt.getTime() <= DUPLICATE_WINDOW_DAYS * DAY);

/**
 * For each of `ids`, the other requests it looks like a copy of, oldest first. Requests that are themselves closed
 * as copies get no hints. One query for the requests and one for every candidate in their courses.
 */
export async function duplicateHints(db: Db, ids: number[], now = new Date()): Promise<Map<number, DuplicateHint[]>> {
  const out = new Map<number, DuplicateHint[]>();
  if (ids.length === 0) return out;
  const targets = (await db.query<CandidateRow>(`${SELECT} where r.id = any($1::bigint[]) and r.status <> 'duplicate'`, [ids])).map(toCandidate);
  if (targets.length === 0) return out;
  const courseIds = [...new Set(targets.map((t) => t.courseId))];
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * DAY);
  const pool = (
    await db.query<CandidateRow>(
      `${SELECT} where r.course_id = any($1::bigint[]) and r.status <> 'duplicate' and (r.status = 'pending' or r.created_at >= $2) order by r.created_at, r.id`,
      [courseIds, since]
    )
  )
    .map(toCandidate)
    .filter((c) => countsAsOther(c, now));
  for (const t of targets) {
    const hints = pool
      .filter((c) => c.id !== t.id)
      .map((c) => ({ c, reasons: hintReasons(t, c) }))
      .filter((x) => x.reasons.length > 0)
      .map(({ c, reasons }): DuplicateHint => ({ id: c.id, studentName: c.studentName, status: c.status, createdAt: c.createdAt, reasons }));
    if (hints.length) out.set(t.id, hints);
  }
  return out;
}

/**
 * The public form, before storing a new request: the oldest request still waiting for the same course from a
 * different student on one of the same phones. The new request is stored anyway, pointing at it.
 */
export async function waitingCopyOf(db: Db, courseId: number, phones: string[]): Promise<number | null> {
  if (phones.length === 0) return null;
  const [row] = await db.query<{ id: string }>(
    `select r.id from registrations r join students s on s.id = r.student_id
      where r.course_id = $1 and r.status = 'pending' and (s.phone = any($2::text[]) or s.guardian_phone = any($2::text[]))
      order by r.created_at, r.id limit 1`,
    [courseId, phones]
  );
  return row ? Number(row.id) : null;
}

export type MarkDuplicateResult = 'saved' | 'missing' | 'not-pending' | 'not-a-hint';

/**
 * «اعتبره مكرر»: closes a waiting request as a copy of `ofId`, which must be one of its current hints. Not a rejection:
 * status 'duplicate', no admin note, and nothing is sent (the WhatsApp box is only offered for accepted / rejected).
 * The audit row holds ids only.
 */
export async function markDuplicate(db: Db, adminId: number, id: number, ofId: number, now = new Date()): Promise<MarkDuplicateResult> {
  return db.tx(async (t) => {
    // Both rows, in id order: two admins closing #5 as a copy of #6 and #6 as a copy of #5 at the same moment would
    // otherwise both succeed and leave the family with no request in the queue. The second now waits, then finds no hint.
    const locked = await t.query<{ id: number | string; status: RegistrationStatus }>('select id, status from registrations where id in ($1, $2) order by id for update', [id, ofId]);
    const r = locked.find((x) => Number(x.id) === id);
    if (!r) return 'missing';
    if (r.status !== 'pending') return 'not-pending';
    const hints = (await duplicateHints(t, [id], now)).get(id) ?? [];
    if (!hints.some((h) => h.id === ofId)) return 'not-a-hint';
    await t.query(`update registrations set status = 'duplicate', duplicate_of = $2, reviewed_by = $3, reviewed_at = now() where id = $1`, [id, ofId, adminId]);
    // Same row shape as lib/admin.ts audit(); written here so lib/registration.ts → this file does not import lib/admin.ts.
    await t.query('insert into audit_log (admin_id, action, target, detail) values ($1, $2, $3, $4)', [adminId, 'registration.duplicate', `registration:${id}`, JSON.stringify({ of: ofId })]);
    return 'saved';
  });
}
