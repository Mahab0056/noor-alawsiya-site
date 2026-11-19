import 'server-only';

/**
 * Outgoing e-mail through Resend's HTTP API (plain fetch, no SDK).
 *
 *   RESEND_API_KEY  a sending-only key (starts with re_). Set on Railway with the operator's script, never in the repo.
 *   MAIL_FROM       sender; until noor-alawsiya.com is verified in Resend: «نور الأوصياء <no-reply@barmjini.com>».
 *   APP_ORIGIN      the site's own origin (https://noor-alawsiya.com). Links in e-mails are built from it only,
 *                   never from the request's Host header, so a forged Host cannot point a link at another site.
 *
 * Nothing here logs the recipient, the link or the key.
 */

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const DEFAULT_MAIL_FROM = 'نور الأوصياء <no-reply@barmjini.com>';

export type MailConfig = { apiKey: string; from: string; origin: string };
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class MailConfigError extends Error {}

/** Reads and checks the mail settings. Throws MailConfigError naming the variable, never its value. */
export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new MailConfigError('RESEND_API_KEY is not set. Nothing was created.');
  if (!/^re_[A-Za-z0-9_]{8,}$/.test(apiKey)) throw new MailConfigError('RESEND_API_KEY does not look like a Resend key (re_…). Nothing was created.');
  const from = env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM;
  if (!/<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(from)) throw new MailConfigError('MAIL_FROM is not a valid sender address. Nothing was created.');
  return { apiKey, from, origin: appOrigin(env) };
}

/** The site's origin from APP_ORIGIN: https only, except http://localhost for local development. */
export function appOrigin(env: Record<string, string | undefined> = process.env) {
  const raw = env.APP_ORIGIN?.trim();
  if (!raw) throw new MailConfigError('APP_ORIGIN is not set (e.g. https://noor-alawsiya.com). Nothing was created.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MailConfigError('APP_ORIGIN is not a valid URL. Nothing was created.');
  }
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new MailConfigError('APP_ORIGIN must be a bare https origin such as https://noor-alawsiya.com. Nothing was created.');
  }
  return url.origin;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const INVITE_SUBJECT = 'دعوة لإدارة موقع نور الأوصياء';

/** Arabic, right-to-left invitation with a plain-text part. The link is the only variable content. */
export function inviteEmail(link: string, role: 'super_admin' | 'admin', hours: number) {
  const roleText = role === 'super_admin' ? 'مديراً أعلى' : 'مشرفاً';
  const text = [
    'السلام عليكم،',
    '',
    `دُعيت لتكون ${roleText} في لوحة إدارة موقع مدرسة نور الأوصياء للدراسات القرآنية.`,
    'افتح الرابط التالي لتضع كلمة المرور وتفعّل التحقق بخطوتين بتطبيق المصادقة على هاتفك:',
    '',
    link,
    '',
    `الرابط يصلح مرة واحدة ولمدة ${hours} ساعة. إن لم تكن تنتظر هذه الدعوة فتجاهل هذه الرسالة.`,
    '',
    'نور الأوصياء',
  ].join('\n');
  const a = escapeHtml(link);
  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${INVITE_SUBJECT}</title></head>
<body dir="rtl" style="margin:0;padding:24px;background:#f6f6f2;font-family:Tahoma,Arial,sans-serif;color:#111;text-align:right">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e5dc">
<p style="margin:0 0 12px">السلام عليكم،</p>
<p style="margin:0 0 12px;line-height:1.8">دُعيت لتكون ${roleText} في لوحة إدارة موقع مدرسة <b>نور الأوصياء</b> للدراسات القرآنية.</p>
<p style="margin:0 0 20px;line-height:1.8">اضغط الزر لتضع كلمة المرور وتفعّل التحقق بخطوتين بتطبيق المصادقة على هاتفك.</p>
<p style="margin:0 0 20px"><a href="${a}" style="display:inline-block;background:#FFFA00;color:#111;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px;border:1px solid #111">قبول الدعوة</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.8">الرابط يصلح مرة واحدة ولمدة ${hours} ساعة. إن لم تكن تنتظر هذه الدعوة فتجاهل هذه الرسالة.</p>
<p dir="ltr" style="margin:0;font-size:12px;color:#777;word-break:break-all;text-align:left">${a}</p>
</div></body></html>`;
  return { subject: INVITE_SUBJECT, text, html };
}

/** Sends one e-mail. Throws on any non-2xx answer, without echoing the address or the body. */
export async function sendMail(config: MailConfig, message: { to: string; subject: string; text: string; html: string }, fetchImpl: Fetch = fetch) {
  let res: Response;
  try {
    res = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('The e-mail could not be sent (network). Nothing was created.');
  }
  if (!res.ok) throw new Error(`The e-mail could not be sent (Resend answered ${res.status}). Nothing was created.`);
}
