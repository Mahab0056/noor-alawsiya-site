/** Session cookie names. Kept apart from lib/session.ts so proxy.ts can read them without pulling in server-only code. */
export const SESSION_COOKIE = { student: 'noor_s', admin: 'noor_a' } as const;
