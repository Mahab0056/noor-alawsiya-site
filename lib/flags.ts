/**
 * ADMIN_TOTP=1 turns the authenticator-app path back on (QR at invite, 6-digit app code at every sign-in).
 * Off by default since Mahab's decision of 19/11/2026 («سويه بس رسالة ايميل بدون qr»): admins sign in with e-mail +
 * password, and a 6-digit code sent by e-mail on a device they have not marked as remembered. The TOTP code is kept.
 */
export const adminTotpEnabled = (env: Record<string, string | undefined> = process.env) => env.ADMIN_TOTP === '1';

/**
 * PROGRESS_TRACKING=1 turns on «المتابعة» (attendance + one short note per pupil per session; lib/progress.ts).
 * Off by default: recording attendance of minors is new personal data, and the privacy text and the school's answers
 * (awsiya-progress-design-2011r) come first. While off, the screens answer 404, the actions refuse, «حسابي» shows nothing
 * new and no teacher can be invited. The tables (0011) exist either way and stay empty.
 */
export const progressEnabled = (env: Record<string, string | undefined> = process.env) => env.PROGRESS_TRACKING === '1';
