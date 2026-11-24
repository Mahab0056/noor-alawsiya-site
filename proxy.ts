import { NextResponse, type NextRequest } from 'next/server';
import { canonicalRedirect, requestHost } from '@/lib/canonical-host';
import { SESSION_COOKIE } from '@/lib/cookie-names';
import { courseRosterOn, isRosterPath, ROSTER_HEADERS, ROSTER_OFF_PATH } from '@/lib/roster-flag';

/**
 * Two quick checks before any page:
 * 1. www.noor-alawsiya.com (and any other non-canonical public name) gets a 308 to https://noor-alawsiya.com with the
 *    same path and query, so search engines see one site. localhost and *.up.railway.app are served as is.
 * 2. Someone with no session cookie on /admin or /account is sent to the right login page with a real redirect
 *    instead of an empty shell. It does not prove the cookie is valid. Every page and every Server Action still
 *    checks the session against the database (lib/session.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = requestHost(request.headers.get('x-forwarded-host'), request.headers.get('host'));
  const canonical = canonicalRedirect(host, pathname, search);
  if (canonical) return NextResponse.redirect(canonical, 308);

  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  const account = pathname === '/account' || pathname.startsWith('/account/');
  if (!admin && !account) return NextResponse.next();
  // The login page, and invite links (opened by someone who has no account yet; the token is checked on the page).
  if (pathname === '/admin/login' || pathname.startsWith('/admin/invite/')) return NextResponse.next();
  // A Server Action call (a form sent from a page that was open when the session ended) is not redirected here: the
  // browser would follow a 307 with the same POST and show «This page couldn't load». Every action checks the session
  // itself and answers with a redirect to the login page that the page can follow.
  if (request.method === 'POST' && request.headers.has('next-action')) return NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE[admin ? 'admin' : 'student'])) {
    return NextResponse.redirect(new URL(admin ? '/admin/login' : '/login', request.url));
  }
  // «كشف الدورة» (lib/roster-flag.ts). A page that streams cannot change its status any more, so this is decided here.
  // OFF: rewritten to an address no route can ever have, so the answer is the site's normal 404 with the same headers
  // as any unknown address (the prerendered /_not-found would add a long s-maxage). ON: never cached, never indexed.
  if (isRosterPath(pathname)) {
    if (!courseRosterOn()) return NextResponse.rewrite(new URL(ROSTER_OFF_PATH, request.url));
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(ROSTER_HEADERS)) res.headers.set(k, v);
    return res;
  }
  return NextResponse.next();
}

// Every page, so the www redirect covers the whole site. Built files, image optimisation, the favicon and public/img
// are left out: they never need the redirect (pages on www never render now) and should not pay for the proxy.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon\\.ico$|img/).*)'] };
