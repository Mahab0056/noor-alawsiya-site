/**
 * ADMIN_TOTP=1 turns the authenticator-app path back on (QR at invite, 6-digit app code at every sign-in).
 * Off by default since Mahab's decision of 19/11/2026 («سويه بس رسالة ايميل بدون qr»): admins sign in with e-mail +
 * password, and a 6-digit code sent by e-mail on a device they have not marked as remembered. The TOTP code is kept.
 */
export const adminTotpEnabled = (env: Record<string, string | undefined> = process.env) => env.ADMIN_TOTP === '1';
