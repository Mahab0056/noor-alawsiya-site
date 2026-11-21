import { SESSION_COOKIE } from './cookie-names';

/**
 * True when the request carries a non-empty student session cookie. Used only to pick the header link
 * (components/StudentNavLink.tsx); it proves nothing about the session, which lib/session.ts checks on every private page.
 */
export function hasStudentCookie(store: { get(name: string): { value: string } | undefined }): boolean {
  return Boolean(store.get(SESSION_COOKIE.student)?.value);
}
