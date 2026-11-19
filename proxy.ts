import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/cookie-names';

/**
 * A quick first check only: someone with no session cookie is sent to the right login page with a real redirect
 * instead of an empty shell. It does not prove the cookie is valid. Every page and every Server Action still
 * checks the session against the database (lib/session.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The login page, and invite links (opened by someone who has no account yet; the token is checked on the page).
  if (pathname === '/admin/login' || pathname.startsWith('/admin/invite/')) return NextResponse.next();
  // A Server Action call (a form sent from a page that was open when the session ended) is not redirected here: the
  // browser would follow a 307 with the same POST and show «This page couldn't load». Every action checks the session
  // itself and answers with a redirect to the login page that the page can follow.
  if (request.method === 'POST' && request.headers.has('next-action')) return NextResponse.next();
  const admin = pathname.startsWith('/admin');
  if (!request.cookies.has(SESSION_COOKIE[admin ? 'admin' : 'student'])) {
    return NextResponse.redirect(new URL(admin ? '/admin/login' : '/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/account/:path*'] };
