/**
 * «عدد المقاعد» per course (0015, flag COURSE_SEATS, default OFF).
 *
 * A seat is taken by an accepted request only. When the accept that fills the last seat is saved, registration for
 * that course closes in the same transaction (lib/admin.ts reviewRequest). Nothing reopens by itself: a super admin
 * opens the course again in «الدورات» once there is room (a seat freed or a higher number).
 *
 * Flag OFF: the field is hidden, nothing closes by itself and the pages are as before. The column is still there
 * (migrations do not follow flags) but nothing reads it.
 */

export function courseSeatsOn(env: Record<string, string | undefined> = process.env) {
  return /^(1|true|on)$/i.test(env.COURSE_SEATS?.trim() ?? '');
}

export const MAX_SEATS = 1000;
/** «باقي N مقاعد» shows only near the end, never as a standing countdown. */
export const SEATS_BADGE_AT = 5;

const AR = new Intl.NumberFormat('ar-EG', { useGrouping: false });

/** The input box: empty = no limit. Arabic-Indic and Persian digits are read too. */
export function parseSeats(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = raw.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (s === '') return { ok: true, value: null };
  if (!/^\d{1,4}$/.test(s) || Number(s) < 1 || Number(s) > MAX_SEATS) return { ok: false, error: `اكتب عدد المقاعد رقماً من ١ إلى ${AR.format(MAX_SEATS)}، أو اتركه فارغاً بلا حد.` };
  return { ok: true, value: Number(s) };
}

/** Seats still free, never below 0. null = the course has no limit. */
export const seatsLeft = (seats: number | null, accepted: number) => (seats === null ? null : Math.max(0, seats - accepted));

/** Show the badge? Only for a limit with 1..5 seats left (0 = the course is closed, shown as closed). */
export const showSeatsBadge = (left: number | null | undefined): left is number => typeof left === 'number' && left >= 1 && left <= SEATS_BADGE_AT;

/** «باقي مقعد واحد»، «باقي مقعدان»، «باقي ٣ مقاعد»… */
export function seatsLeftLabel(n: number) {
  if (n === 1) return 'باقي مقعد واحد';
  if (n === 2) return 'باقي مقعدان';
  return `باقي ${AR.format(n)} ${n >= 3 && n <= 10 ? 'مقاعد' : 'مقعداً'}`;
}

/** «٣ مقاعد»، «مقعد واحد»… for the admin list. */
export function seatsCount(n: number) {
  if (n === 1) return 'مقعد واحد';
  if (n === 2) return 'مقعدان';
  return `${AR.format(n)} ${n >= 3 && n <= 10 ? 'مقاعد' : 'مقعداً'}`;
}
