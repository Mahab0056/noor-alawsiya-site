/** Session cookie names. Kept apart from lib/session.ts so proxy.ts can read them without pulling in server-only code. */
export const SESSION_COOKIE = { student: 'noor_s', admin: 'noor_a' } as const;
/** Admin sign-in by e-mail code: the pending challenge (10 minutes) and a remembered device (30 days). */
export const ADMIN_CODE_COOKIE = 'noor_ac';
export const ADMIN_DEVICE_COOKIE = 'noor_ad';
