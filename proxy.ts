import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/cookie-names';

/**
 * A quick first check only: someone with no session cookie is sent to the right login page with a real redirect
 * instead of an empty shell. It does not prove the cookie is valid. Every page and every Server Action still
 * checks the session against the database (lib/session.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin/login') return NextResponse.next();
  const admin = pathname.startsWith('/admin');
  if (!request.cookies.has(SESSION_COOKIE[admin ? 'admin' : 'student'])) {
    return NextResponse.redirect(new URL(admin ? '/admin/login' : '/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/account/:path*'] };
