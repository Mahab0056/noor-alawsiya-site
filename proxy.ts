import { NextResponse, type NextRequest } from 'next/server';
import { canonicalRedirect, requestHost } from '@/lib/canonical-host';
import { SESSION_COOKIE } from '@/lib/cookie-names';
import { courseBySlug } from '@/lib/share';
import { welcomeEnabled } from '@/lib/welcome-config';

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

  // Flag WELCOME_PAGE off (the default): /welcome/* is a real 404. Decided here, per request, so switching the flag needs no rebuild
  // (a page that reads the variable itself would keep the value it saw at build time).
  if ((pathname === '/welcome' || pathname.startsWith('/welcome/')) && !welcomeEnabled()) {
    return NextResponse.rewrite(new URL('/welcome-is-off', request.url));
  }
  // Flag on: the page decides ownership inside <Suspense>, where a notFound() can only give the 404 page with status 200
  // (Cache Components sends the shell first; node_modules/next/dist/docs/01-app/02-guides/streaming.md, «The HTTP contract»).
  // The cases that need no database get a real 404 here: no student session cookie (guests, crawlers, an admin alone) and
  // a slug that is no course. Nothing here depends on whose course it is, so the status tells nobody anything new.
  if (pathname.startsWith('/welcome/') && (!request.cookies.has(SESSION_COOKIE.student) || !courseBySlug(pathname.slice('/welcome/'.length)))) {
    return NextResponse.rewrite(new URL('/welcome-is-off', request.url));
  }

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
  return NextResponse.next();
}

// Every page, so the www redirect covers the whole site. Built files, image optimisation, the favicon and public/img
// are left out: they never need the redirect (pages on www never render now) and should not pay for the proxy.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon\\.ico$|img/).*)'] };
