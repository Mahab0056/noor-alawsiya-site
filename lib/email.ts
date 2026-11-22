import 'server-only';

/**
 * Transactional email through Resend's HTTP API.
 *
 * One fetch instead of an SDK: nothing to keep up to date, and the refusal body ends up in the
 * deploy log. A silent email failure is the worst outcome here — the admin simply never gets in.
 */

export type Mail = { to: string; subject: string; html: string; text: string };
export type Mailer = (mail: Mail) => Promise<void>;

export const sendEmail: Mailer = async ({ to, subject, html, text }) => {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key) throw new Error('RESEND_API_KEY is not set.');
  if (!from) throw new Error('EMAIL_FROM is not set.');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    // Resend's body names the actual reason (unverified domain, bad key, blocked recipient).
    const body = await res.text().catch(() => '');
    const error = new Error(`Resend refused the message (${res.status}): ${body.slice(0, 500)}`);
    console.error(error.message);
    throw error;
  }
};

const SCHOOL = 'نور الأوصياء';

/** The login code email. Inline styles only: no external stylesheet or image survives a mail client. */
export function adminCodeMail(code: string): Omit<Mail, 'to'> {
  const spaced = code.split('').join(' ');
  return {
    subject: `رمز الدخول إلى لوحة الإدارة`,
    text: `رمز الدخول إلى لوحة إدارة ${SCHOOL}: ${code}\n\nصالح عشر دقائق ويُستعمل مرة واحدة.\nإذا لم تطلب الدخول فتجاهل هذه الرسالة.`,
    html: `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;padding:24px;background:#f6f6f4;font-family:system-ui,'Segoe UI',Tahoma,sans-serif;color:#17160f">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;text-align:right">
    <p style="margin:0 0 4px;font-size:15px;font-weight:700">${SCHOOL}</p>
    <p style="margin:0 0 20px;font-size:13px;color:#6b6a60">لوحة الإدارة</p>
    <p style="margin:0 0 12px;font-size:15px">رمز الدخول:</p>
    <p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:6px;direction:ltr;text-align:center;background:#faf7ea;border-radius:10px;padding:16px 0">${spaced}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#44433a">الرمز صالح عشر دقائق ويُستعمل مرة واحدة.</p>
    <p style="margin:0;font-size:13px;color:#6b6a60">إذا لم تطلب الدخول فتجاهل هذه الرسالة ولا تشاركها مع أحد.</p>
  </div>
</body></html>`,
  };
}
