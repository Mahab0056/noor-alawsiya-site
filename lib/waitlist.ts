import 'server-only';
import { audit } from './admin';
import type { Db } from './db';
import { AGE_BAND_LABEL, WAITLIST_CONSENT_VERSION, type AgeBand, type CleanWaitlist } from './waitlist-rules';
import { whatsappNumber } from './whatsapp';

/**
 * «بلّغوني لما تنفتح دورة»: the waitlist behind it.
 *
 * - Public side (app/actions.ts waitlistAction): validate, then the per-address caps, then store. A repeat of the same
 *   phone for the same course (or «أي دورة») stores nothing new and gets the same thank-you as the first time.
 * - Admin side (app/admin/waitlist): any signed-in admin, like «طلبات التسجيل». The site sends nothing: each row has a
 *   wa.me link that opens a prepared chat on the admin's own phone. «تم التبليغ» and «احذف» are separate, explicit buttons.
 * - Removal blanks the phone and the name; the row stays with no personal data, for counting only.
 * - Retention (proposed, waiting for Mahab): a number is blanked WAITLIST_KEEP_DAYS after the course notice, or on request.
 * - The audit log holds the row id only, never a phone or a name.
 */

export const MAX_WAITLIST_PER_IP_HOUR = 5;
export const MAX_WAITLIST_PER_IP_DAY = 10;
/** Site-wide ceiling on new rows in 24 hours, so a flood from many addresses cannot fill the list. */
export const MAX_WAITLIST_NEW_PER_DAY = 300;
/** مقترح لمهاب: the number is kept this many days after «تم التبليغ», then blanked. */
export const WAITLIST_KEEP_DAYS = 90;

/** Courses a visitor may wait for: not finished and not taking registrations now. */
export type WaitCourse = { id: number; name: string };
export async function listWaitlistCourses(db: Db): Promise<WaitCourse[]> {
  const rows = await db.query<{ id: string; name: string }>(`select id, name from courses where status <> 'done' and not (published and status = 'open') order by id`);
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

/** Per-address caps. Counted only for valid submissions, so a typo does not use one up. */
export async function allowWaitlist(db: Db, ip: string) {
  await db.query(`delete from waitlist_attempts where created_at < now() - interval '1 day'`);
  return db.tx(async (t) => {
    await t.query(`select pg_advisory_xact_lock(4, hashtext($1))`, [ip]);
    const [row] = await t.query<{ hour: string; day: string }>(
      `select count(*) filter (where created_at > now() - interval '1 hour') as hour, count(*) as day from waitlist_attempts where ip = $1`,
      [ip],
    );
    if (Number(row.hour) >= MAX_WAITLIST_PER_IP_HOUR || Number(row.day) >= MAX_WAITLIST_PER_IP_DAY) return false;
    await t.query('insert into waitlist_attempts (ip) values ($1)', [ip]);
    return true;
  });
}

export type JoinResult = 'saved' | 'full';

/** 'saved' also for a repeat: the visitor cannot tell whether the number was already on the list. */
export async function joinWaitlist(db: Db, w: CleanWaitlist, now = new Date()): Promise<JoinResult> {
  try {
    return await storeWaitlist(db, w, now);
  } catch (e) {
    // The same phone and course from two requests at once: the unique index stops the second one. Same answer.
    if ((e as { code?: string }).code === '23505') return 'saved';
    throw e;
  }
}

function storeWaitlist(db: Db, w: CleanWaitlist, now: Date): Promise<JoinResult> {
  return db.tx(async (t) => {
    await t.query('select pg_advisory_xact_lock(5, 0)');
    const [{ n }] = await t.query<{ n: string }>(`select count(*) as n from course_waitlist where created_at > now() - interval '24 hours'`);
    const [dup] = await t.query<{ id: string }>(`select id from course_waitlist where removed_at is null and phone = $1 and coalesce(course_id, 0) = coalesce($2::bigint, 0)`, [w.phone, w.courseId]);
    if (dup) {
      // Asked again: keep the first details, renew the consent, and wait for the next opening if they were already told.
      await t.query(`update course_waitlist set consent_version = $2, consented_at = $3, notified_at = null where id = $1`, [dup.id, WAITLIST_CONSENT_VERSION, now]);
      return 'saved';
    }
    if (Number(n) >= MAX_WAITLIST_NEW_PER_DAY) return 'full';
    await t.query(
      `insert into course_waitlist (guardian_name, phone, course_id, age_band, consent_version, consented_at) values ($1, $2, $3, $4, $5, $6)`,
      [w.guardianName, w.phone, w.courseId, w.ageBand, WAITLIST_CONSENT_VERSION, now],
    );
    return 'saved';
  });
}

export type WaitEntry = { id: number; guardianName: string | null; phone: string; ageBand: AgeBand | null; createdAt: Date; notifiedAt: Date | null };
export type WaitGroup = { courseId: number | null; course: string | null; accepting: boolean; done: boolean; waiting: number; entries: WaitEntry[] };

/** The live list, by course interest. «أي دورة» first, then courses taking registrations, then the rest. */
export async function listWaitlist(db: Db): Promise<WaitGroup[]> {
  const rows = await db.query<{ id: string; guardian_name: string | null; phone: string; age_band: AgeBand | null; created_at: Date; notified_at: Date | null; course_id: string | null; course: string | null; accepting: boolean | null; done: boolean | null }>(
    `select w.id, w.guardian_name, w.phone, w.age_band, w.created_at, w.notified_at, w.course_id,
            c.name as course, (c.published and c.status = 'open') as accepting, (c.status = 'done') as done
       from course_waitlist w left join courses c on c.id = w.course_id
      where w.removed_at is null
      order by (w.course_id is null) desc, (c.published and c.status = 'open') desc nulls last, w.course_id, (w.notified_at is not null), w.created_at`,
  );
  const groups = new Map<string, WaitGroup>();
  for (const r of rows) {
    const key = r.course_id ?? 'any';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { courseId: r.course_id === null ? null : Number(r.course_id), course: r.course, accepting: Boolean(r.accepting), done: Boolean(r.done), waiting: 0, entries: [] }));
    g.entries.push({ id: Number(r.id), guardianName: r.guardian_name, phone: r.phone, ageBand: r.age_band, createdAt: new Date(r.created_at), notifiedAt: r.notified_at ? new Date(r.notified_at) : null });
    if (!r.notified_at) g.waiting++;
  }
  return [...groups.values()];
}

/** Not yet told, per course id; `any` = «أي دورة». For the banner in «الدورات». */
export async function waitingCounts(db: Db): Promise<{ byCourse: Map<number, number>; any: number }> {
  const rows = await db.query<{ course_id: string | null; n: string }>(
    `select course_id, count(*) as n from course_waitlist where removed_at is null and notified_at is null group by course_id`,
  );
  const byCourse = new Map<number, number>();
  let any = 0;
  for (const r of rows) {
    if (r.course_id === null) any = Number(r.n);
    else byCourse.set(Number(r.course_id), Number(r.n));
  }
  return { byCourse, any };
}

export async function markNotified(db: Db, adminId: number, id: number) {
  const done = await db.query(`update course_waitlist set notified_at = now() where id = $1 and removed_at is null returning id`, [id]);
  if (done.length) await audit(db, adminId, 'waitlist.notified', `waitlist:${id}`);
  return done.length > 0;
}

/** «احذف»: on request (a reply «إلغاء») or by hand. The phone and the name are blanked; the row keeps no personal data. */
export async function removeEntry(db: Db, adminId: number | null, id: number) {
  const done = await db.query(`update course_waitlist set removed_at = now(), phone = null, guardian_name = null where id = $1 and removed_at is null returning id`, [id]);
  if (done.length) await audit(db, adminId, 'waitlist.removed', `waitlist:${id}`);
  return done.length > 0;
}

/** Blanks numbers told about a course more than WAITLIST_KEEP_DAYS ago. Runs whenever an admin opens the list. */
export async function purgeWaitlist(db: Db) {
  const rows = await db.query(
    `update course_waitlist set removed_at = now(), phone = null, guardian_name = null
      where removed_at is null and notified_at < now() - make_interval(days => $1) returning id`,
    [WAITLIST_KEEP_DAYS],
  );
  return rows.length;
}

const SCHOOL = 'مدرسة نور الأوصياء للدراسات القرآنية';

/**
 * The WhatsApp text for one group. No name, no phone. The link is plain /register: an Arabic course name in the query
 * would show as a long %-encoded string in the chat, and the course name is already in the text. Null when there is nothing to tell yet (the course is still closed,
 * or for «أي دورة» no course is open), so nobody gets a message that promises what the site does not have.
 */
export function waitlistMessage(group: { course: string | null; accepting: boolean }, anyOpen: boolean, origin: string): string | null {
  if (group.course !== null && !group.accepting) return null;
  if (group.course === null && !anyOpen) return null;
  const what =
    group.course !== null
      ? `انفتح التسجيل في «${group.course}». تگدرون تسجّلون من هنا: ${origin}/register`
      : `انفتح التسجيل بدورات جديدة. تشوفون الدورات المفتوحة وتسجّلون من هنا: ${origin}/register`;
  return ['السلام عليكم،', `من ${SCHOOL}: ${what}`, 'وصلتكم هالرسالة لأنكم طلبتوا نبلّغكم. إذا ما تريدون رسائل بعد، ردّوا بكلمة «إلغاء» ونمسح رقمكم.'].join('\n');
}

export const waLink = (phone: string, text: string) => {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
};

export { AGE_BAND_LABEL };
