import { arDigits, daysText, hoursText, minutesText } from './format';
import type { RegistrationStatus } from './registration';

/**
 * The admin «طلبات التسجيل» queue: how long each pending request has waited, so the first real requests are answered
 * within 48 hours (awsiya plan, step 5). Pure functions: the page passes the current time, the tests pass fixed instants.
 *
 * Elapsed time does not depend on a time zone. The dates shown next to it are in Baghdad time (lib/format.ts).
 * Nothing here sends anything: no e-mail, no WhatsApp, no reminder.
 */

const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const LATE_AFTER_HOURS = 24;
export const OVERDUE_AFTER_HOURS = 48;

export type WaitLevel = 'fresh' | 'late' | 'overdue';

/** A request dated in the future (clock skew between the database and the app) counts as just arrived. */
export const waitedMs = (createdAt: Date, now: Date) => Math.max(0, now.getTime() - createdAt.getTime());

/** fresh < 24 h ≤ late (amber) < 48 h ≤ overdue (red). Exactly 24:00 is late, exactly 48:00 is overdue. */
export function waitLevel(createdAt: Date, now: Date): WaitLevel {
  const ms = waitedMs(createdAt, now);
  if (ms >= OVERDUE_AFTER_HOURS * HOUR) return 'overdue';
  if (ms >= LATE_AFTER_HOURS * HOUR) return 'late';
  return 'fresh';
}

/** Tag colours the panel already has: neutral, amber (warn), red (bad). */
export const WAIT_TAG: Record<WaitLevel, string> = { fresh: 'wait', late: 'warn', overdue: 'bad' };

/**
 * «٣ ساعات», rounded down. Hours up to 48 (the deadline is counted in hours, so «٣٠ ساعة» says more than «يوم»),
 * whole days after that. Works after «ينتظر» and after «منذ».
 */
export function waitedText(createdAt: Date, now: Date): string {
  const minutes = Math.floor(waitedMs(createdAt, now) / MINUTE);
  if (minutes < 1) return 'أقل من دقيقة';
  if (minutes < 60) return minutesText(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < OVERDUE_AFTER_HOURS) return hoursText(hours);
  return daysText(Math.floor(hours / 24));
}

/** The badge on a pending request: «ينتظر ٣ ساعات». */
export const waitBadgeText = (createdAt: Date, now: Date) => `ينتظر ${waitedText(createdAt, now)}`;

/** Top of the admin home: «٣ طلبات تنتظر، أقدمها منذ ٥ ساعات». `oldest` is the oldest pending request, any course. */
export function pendingSummary(count: number, oldest: Date | null, now: Date): string {
  if (count <= 0 || !oldest) return 'لا طلبات بانتظار المراجعة';
  const since = waitedText(oldest, now);
  if (count === 1) return `طلب واحد ينتظر منذ ${since}`;
  if (count === 2) return `طلبان ينتظران، أقدمهما منذ ${since}`;
  if (count <= 10) return `${arDigits(count)} طلبات تنتظر، أقدمها منذ ${since}`;
  return `${arDigits(count)} طلباً ينتظر، أقدمها منذ ${since}`;
}

// ---------------------------------------------------------------- list view: status, course, order (all from the URL)

export const STATUSES: RegistrationStatus[] = ['pending', 'accepted', 'rejected'];
/** The tabs. «مكرر» (requests closed as copies) only with DUPLICATE_HINTS on; off, the list is exactly as before. */
export const queueStatuses = (duplicateHints: boolean): RegistrationStatus[] => (duplicateHints ? [...STATUSES, 'duplicate'] : STATUSES);
export type QueueSort = 'oldest' | 'newest';
export type QueueView = { status: RegistrationStatus; courseId: number | null; sort: QueueSort };

/** Waiting requests oldest first (answer them in order); decided ones newest first, as before. */
export const defaultSort = (status: RegistrationStatus): QueueSort => (status === 'pending' ? 'oldest' : 'newest');

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/** Unknown or repeated values fall back to the defaults: pending, every course, the status's own order. */
export function parseQueueView(params: Params, statuses: RegistrationStatus[] = STATUSES): QueueView {
  const status = statuses.find((s) => s === one(params.status)) ?? 'pending';
  const course = one(params.course);
  const courseId = course && /^\d{1,15}$/.test(course) && Number(course) > 0 ? Number(course) : null;
  const sort = one(params.sort) === 'oldest' ? 'oldest' : one(params.sort) === 'newest' ? 'newest' : defaultSort(status);
  return { status, courseId, sort };
}

/** The /admin address for a view. Defaults are left out, so the plain tabs stay /admin?status=… as before. */
export function queueHref(view: QueueView, extra: { id?: number } = {}): string {
  const q = new URLSearchParams({ status: view.status });
  if (view.courseId) q.set('course', String(view.courseId));
  if (view.sort !== defaultSort(view.status)) q.set('sort', view.sort);
  if (extra.id) q.set('id', String(extra.id));
  return `/admin?${q.toString()}`;
}
