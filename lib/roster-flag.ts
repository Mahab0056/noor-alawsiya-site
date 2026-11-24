/**
 * «كشف الدورة» (flag COURSE_ROSTER, default OFF): the parts the proxy needs, with no database import.
 *
 * Flag OFF: no link in «الدورات», and proxy.ts answers the roster address with the site's normal 404 before the page
 * renders, so the response is the same as on a build without the feature. Flag ON: the proxy adds
 * `Cache-Control: no-store` and `X-Robots-Tag: noindex` to the roster response.
 */

export function courseRosterOn(env: Record<string, string | undefined> = process.env) {
  return /^(1|true|on)$/i.test(env.COURSE_ROSTER?.trim() ?? '');
}

/** /admin/courses/<id>/roster, with or without a trailing slash. Any id shape: the page itself checks the id. */
export const isRosterPath = (pathname: string) => /^\/admin\/courses\/[^/]+\/roster\/?$/.test(pathname);

export const rosterHref = (courseId: number) => `/admin/courses/${courseId}/roster`;

export const ROSTER_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

/** Flag OFF target. App Router folders that start with «_» are private and never routes, so this is always a 404. */
export const ROSTER_OFF_PATH = '/_roster-off';
