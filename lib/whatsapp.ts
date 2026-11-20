import { isMinor, normalizePhone } from './form-rules';

/**
 * «إبلاغ عبر واتساب»: after a decision, an admin opens WhatsApp on their own phone with a prepared message.
 * Nothing is sent by the site: wa.me only opens a chat, and the admin decides whether to press send.
 * No WhatsApp API, no cost. Pure functions, so they can be tested without a database.
 */

const SCHOOL = 'مدرسة نور الأوصياء للدراسات القرآنية';
export const DEFAULT_ORIGIN = 'https://noor-alawsiya.com';

/** An Iraqi mobile number in the international form wa.me wants (9647XXXXXXXXX), or null if it is not one. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const local = phone ? normalizePhone(phone) : null; // 07XXXXXXXXX
  return local ? `964${local.slice(1)}` : null;
}

export type NotifyRecipient = 'guardian' | 'student';

/** A minor's guardian gets the message; everyone else gets it on their own phone. */
export function notifyRecipient(r: { birthYear: number; phone: string; guardianPhone: string | null }, now = new Date()): { to: NotifyRecipient; number: string | null } {
  if (isMinor(r.birthYear, now) && r.guardianPhone) return { to: 'guardian', number: whatsappNumber(r.guardianPhone) };
  return { to: 'student', number: whatsappNumber(r.phone) };
}

/** Short and polite: the course and the result, and the /account link. No name, no note, no password, no phone. */
export function decisionMessage(decision: 'accepted' | 'rejected', course: string, origin = DEFAULT_ORIGIN): string {
  const result =
    decision === 'accepted'
      ? `يسرّنا إبلاغكم بقبول طلب التسجيل في «${course}». ستتواصل معكم إدارة المدرسة بموعد الحلقة ومكانها.`
      : `نعتذر، لم يُقبل طلب التسجيل في «${course}» هذه المرة. يمكنكم التواصل مع إدارة المدرسة للاستفسار.`;
  return ['السلام عليكم ورحمة الله وبركاته،', `من ${SCHOOL}: ${result}`, `التفاصيل في الحساب على الموقع: ${origin}/account`].join('\n');
}

export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
