import 'server-only';
import { randomInt } from 'node:crypto';
import { audit } from './admin';
import { hashPassword } from './auth';
import type { Db } from './db';
import { DEFAULT_ORIGIN, notifyRecipient, type NotifyRecipient } from './whatsapp';

/**
 * «نسي الطالب كلمة المرور»: an admin makes a temporary password from a request the student made, and sends it by
 * WhatsApp to the number already on file (the guardian's for a minor). Before this there was no way back: no reset,
 * and registering again with the same name and phone is refused.
 *
 * - The new password replaces the old one at once, and every session of that student ends.
 * - Failed sign-ins for the student's phone are cleared: a student who forgot the password has usually used up the
 *   five tries, and would otherwise be told «انتظر ربع ساعة» with the new password in hand.
 * - It is returned once, to the admin who asked, and never stored or logged in clear (argon2id hash only).
 * - audit_log gets `student.password_reset` with `student:<id>` only: no name, no phone, no password.
 */

// No 0/o, 1/l/i: read aloud or copied from a phone screen without mistakes. 31 symbols ^ 10 ≈ 2^49.
export const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const TEMP_LENGTH = 10;

export function tempPassword() {
  let out = '';
  for (let i = 0; i < TEMP_LENGTH; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}

/** phoneEnd: the last 4 digits of the phone the student signs in with (for a minor this is not the guardian's number). */
export type StudentReset = { password: string; to: NotifyRecipient; number: string | null; phoneEnd: string };

/** For the student behind registration `registrationId`. null if there is no such request. */
export async function resetStudentPassword(db: Db, adminId: number, registrationId: number): Promise<StudentReset | null> {
  const password = tempPassword();
  const hash = await hashPassword(password); // outside the transaction: argon2 is slow on purpose
  return db.tx(async (t) => {
    const [s] = await t.query<{ id: string; birth_year: number; phone: string; guardian_phone: string | null }>(
      `select s.id, s.birth_year, s.phone, s.guardian_phone from registrations r join students s on s.id = r.student_id where r.id = $1 for update of s`,
      [registrationId]
    );
    if (!s) return null;
    await t.query('update students set password_hash = $2 where id = $1', [s.id, hash]);
    await t.query('delete from sessions where student_id = $1', [s.id]);
    await t.query(`delete from login_attempts where scope = 'student' and identifier = $1 and not succeeded`, [s.phone]);
    await audit(t, adminId, 'student.password_reset', `student:${s.id}`);
    const { to, number } = notifyRecipient({ birthYear: s.birth_year, phone: s.phone, guardianPhone: s.guardian_phone });
    return { password, to, number, phoneEnd: s.phone.slice(-4) };
  });
}

/**
 * The WhatsApp text: the password and where to use it. No name, so a sibling sharing the phone is not exposed. It says
 * which phone to sign in with (last 4 digits): a guardian gets it for a minor, and sign-in only takes the student's phone.
 */
export function tempPasswordMessage(password: string, origin = DEFAULT_ORIGIN, phoneEnd?: string) {
  return [
    'السلام عليكم ورحمة الله وبركاته،',
    'من مدرسة نور الأوصياء للدراسات القرآنية: هذه كلمة مرور مؤقتة لحساب الطالب على الموقع، والكلمة السابقة لم تعد تعمل.',
    password,
    `ادخل من ${origin}/login برقم هاتف الطالب${phoneEnd ? ` المنتهي بـ ${phoneEnd}` : ' المسجّل في الطلب'} وهذه الكلمة. لا تعطها لأحد.`,
  ].join('\n');
}
