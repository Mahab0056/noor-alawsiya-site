import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { countPendingSentBy, countRequests, listCourseFilterOptions, oldestPendingAt } from './admin';
import type { Db } from './db';
import { sendEmail, type Mail, type Mailer } from './email';
import { arDigits, formatDate } from './format';
import { appOrigin } from './mail';
import { HOUR, OVERDUE_AFTER_HOURS, pendingSummary, waitedText } from './queue';

/**
 * The daily digest to the super admins: «٨ طلبات تنتظر، أقدمها منذ ٥ أيام», so no request waits 48 hours unseen
 * (awsiya plan, step 5). Counts and public course names only: no student or guardian name, phone, age or note, so a
 * forwarded e-mail leaks nothing.
 *
 *   ADMIN_DIGEST        1 / true / on turns it on. Default off: the route answers 404, `npm run digest` prints «off»,
 *                       and nothing is read, written or sent.
 *   ADMIN_DIGEST_TOKEN  the bearer token for POST /api/cron/admin-digest (32+ characters). Unset, short or wrong = 404.
 *
 * At most one digest per Baghdad day: admin_digest_log (0016) gets one row per day, claimed before anything is sent.
 * Nothing is sent, and no row is written, when no request waits or no super admin is active.
 * Mail goes through lib/email.ts (Resend, noreply@mail.noor-alawsiya.com), the same path as the login codes.
 */

type Env = Record<string, string | undefined>;

export function adminDigestOn(env: Env = process.env) {
  return /^(1|true|on)$/i.test(env.ADMIN_DIGEST?.trim() ?? '');
}

export const MIN_TOKEN_LENGTH = 32;

/** `Authorization: Bearer <ADMIN_DIGEST_TOKEN>`, compared in constant time. Missing, short or unset = false. */
export function digestTokenOk(authorization: string | null | undefined, env: Env = process.env): boolean {
  const expected = env.ADMIN_DIGEST_TOKEN?.trim() ?? '';
  const given = /^Bearer ([^\s]+)$/.exec(authorization?.trim() ?? '')?.[1] ?? '';
  // Hashing both sides gives equal lengths, so timingSafeEqual never throws and the length is not revealed.
  const same = timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
  return same && expected.length >= MIN_TOKEN_LENGTH && given.length > 0;
}

const BAGHDAD_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' });
/** The calendar day in Baghdad (UTC+3, no daylight saving) as YYYY-MM-DD. 21:00 UTC starts the next day. */
export const baghdadDay = (now: Date) => BAGHDAD_DAY.format(now);

export type DigestStats = {
  waiting: number;
  oldest: Date | null;
  /** Waiting 48 hours or more (red in /admin). */
  overdue: number;
  courses: { name: string; waiting: number }[];
};

/** The same queries as the /admin queue (lib/admin.ts), so the e-mail and the screen agree. */
export async function digestStats(db: Db, now: Date): Promise<DigestStats> {
  const [counts, oldest, overdue, options] = await Promise.all([
    countRequests(db),
    oldestPendingAt(db),
    countPendingSentBy(db, new Date(now.getTime() - OVERDUE_AFTER_HOURS * HOUR)),
    listCourseFilterOptions(db),
  ]);
  return { waiting: counts.pending, oldest, overdue, courses: options.filter((o) => o.pending > 0).map((o) => ({ name: o.name, waiting: o.pending })) };
}

/** The waiting list, oldest first, on the site's own origin (never a request's Host). */
export const digestLink = (origin: string) => `${origin}/admin?${new URLSearchParams({ status: 'pending', sort: 'oldest' })}`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** A course name is typed by an admin: one line, bounded. */
const courseName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 80);

const FOOTER = 'رسالة آلية تصل المديرين الأعلين مرة واحدة في اليوم إذا كان هناك طلب ينتظر. لا تحتوي على اسم طالب ولا رقم هاتف.';

/** Modern Standard Arabic, right to left, inline styles only, with a plain-text part. Counts and course names only. */
export function digestMail(stats: DigestStats, now: Date, origin: string): Omit<Mail, 'to'> {
  const headline = pendingSummary(stats.waiting, stats.oldest, now);
  const since = stats.oldest ? waitedText(stats.oldest, now) : '—';
  const link = digestLink(origin);
  const date = formatDate(now);
  const rows: [string, string][] = [
    ['طلبات تنتظر المراجعة', arDigits(stats.waiting)],
    [stats.waiting === 1 ? 'ينتظر منذ' : 'أقدمها ينتظر منذ', since],
    [`تجاوزت ${arDigits(OVERDUE_AFTER_HOURS)} ساعة`, arDigits(stats.overdue)],
  ];
  const courses = stats.courses.map((c) => [courseName(c.name), arDigits(c.waiting)] as const);

  const text = [
    'السلام عليكم،',
    '',
    `${headline}.`,
    '',
    ...rows.map(([k, v]) => `- ${k}: ${v}`),
    '',
    'حسب الدورة:',
    ...courses.map(([k, v]) => `- ${k}: ${v}`),
    '',
    'افتح طلبات التسجيل، الأقدم أولاً:',
    link,
    '',
    FOOTER,
    `نور الأوصياء، ${date}`,
  ].join('\n');

  const cell = 'padding:10px 12px;border-top:1px solid #ecebe3;font-size:15px';
  const num = `${cell};text-align:left;font-weight:bold;white-space:nowrap`;
  const a = escapeHtml(link);
  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(headline)}</title></head>
<body dir="rtl" style="margin:0;padding:24px 12px;background:#f6f6f2;font-family:Tahoma,Arial,sans-serif;color:#17160f;text-align:right">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e5dc">
<p style="margin:0 0 4px;font-size:15px;font-weight:bold">نور الأوصياء</p>
<p style="margin:0 0 20px;font-size:13px;color:#6b6a60">ملخص طلبات التسجيل، ${escapeHtml(date)}</p>
<p style="margin:0 0 16px">السلام عليكم،</p>
<p style="margin:0 0 20px;font-size:19px;font-weight:bold;line-height:1.6">${escapeHtml(headline)}</p>
<table role="presentation" dir="rtl" style="width:100%;border-collapse:collapse;margin:0 0 20px">
${rows.map(([k, v], i) => `<tr><td style="${cell}">${escapeHtml(k)}</td><td style="${num}${i === 2 && stats.overdue > 0 ? ';color:#b3261e' : ''}">${escapeHtml(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:0 0 8px;font-size:14px;font-weight:bold">حسب الدورة</p>
<table role="presentation" dir="rtl" style="width:100%;border-collapse:collapse;margin:0 0 24px">
${courses.map(([k, v]) => `<tr><td style="${cell}">${escapeHtml(k)}</td><td style="${num}">${escapeHtml(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:0 0 24px"><a href="${a}" style="display:inline-block;background:#FFFA00;color:#111;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px;border:1px solid #111">افتح طلبات التسجيل، الأقدم أولاً</a></p>
<p style="margin:0;font-size:13px;color:#555;line-height:1.8">${FOOTER}</p>
</div></body></html>`;
  return { subject: `نور الأوصياء: ${headline}`, text, html };
}

/** Active super admins (owner rows from before 0013 count too). Staff are left out. Addresses only from the database. */
export async function digestRecipients(db: Db): Promise<string[]> {
  const rows = await db.query<{ email: string }>(
    `select email from admins where role in ('owner', 'super_admin') and activated_at is not null and disabled_at is null order by id`
  );
  return rows.map((r) => r.email);
}

export type DigestResult =
  | { status: 'off' }
  | { status: 'already'; day: string }
  | { status: 'nothing'; day: string }
  | { status: 'no-recipients'; day: string; waiting: number }
  | { status: 'sent'; day: string; waiting: number; sent: number; failed: number };

/**
 * One run, as the cron route and `npm run digest` call it. Off: returns before touching the database.
 * Throws (and keeps no row, so a later call can try again) when APP_ORIGIN or the mail settings are missing, or no
 * e-mail could be sent.
 * The result holds counts only, never an address.
 */
export async function runAdminDigest(db: Db, now: Date, { send = sendEmail, env = process.env }: { send?: Mailer; env?: Env } = {}): Promise<DigestResult> {
  if (!adminDigestOn(env)) return { status: 'off' };
  const origin = appOrigin(env);
  // The real sender needs these; say which one is missing (by name) before anything is read or written.
  if (send === sendEmail) for (const name of ['RESEND_API_KEY', 'EMAIL_FROM']) if (!env[name]?.trim()) throw new Error(`${name} is not set. Nothing was sent.`);
  const day = baghdadDay(now);
  const [logged] = await db.query('select 1 from admin_digest_log where day = $1', [day]);
  if (logged) return { status: 'already', day };

  const stats = await digestStats(db, now);
  if (stats.waiting === 0) return { status: 'nothing', day };
  const recipients = await digestRecipients(db);
  if (recipients.length === 0) return { status: 'no-recipients', day, waiting: stats.waiting };

  // The claim comes before the first send: of two calls at the same moment, only one gets the row.
  const claimed = await db.query('insert into admin_digest_log (day, waiting) values ($1, $2) on conflict (day) do nothing returning day', [day, stats.waiting]);
  if (claimed.length === 0) return { status: 'already', day };

  const mail = digestMail(stats, now, origin);
  let sent = 0;
  for (const to of recipients) {
    try {
      await send({ to, ...mail }); // one message per admin: nobody sees another admin's address
      sent++;
    } catch {
      // lib/email.ts already logged Resend's reason; the address is not repeated here.
    }
  }
  if (sent === 0) {
    await db.query('delete from admin_digest_log where day = $1', [day]);
    throw new Error('The admin digest could not be sent to anyone. No day was recorded, so the next call tries again.');
  }
  return { status: 'sent', day, waiting: stats.waiting, sent, failed: recipients.length - sent };
}
