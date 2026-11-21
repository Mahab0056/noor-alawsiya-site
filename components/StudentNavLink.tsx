import { cookies } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import { hasStudentCookie } from '@/lib/student-nav';

/**
 * The last header link: «حسابي» when the browser holds a student session cookie, «دخول الطلاب» otherwise. It is
 * streamed into the prerendered page like RegistrationStrip (the page itself stays static), and the fallback is the
 * login link. The other label is always there too, hidden and zero-height (.spare in app/site.css), so the link always
 * has the width of the longer label and nothing in the header moves when the real one arrives. Only the cookie is checked, not the
 * database: a stale cookie still shows «حسابي», and /account itself sends that visitor to /login (requireStudent).
 */
export function StudentLink({ signedIn, current = false }: { signedIn: boolean; current?: boolean }) {
  return (
    <Link href={signedIn ? '/account' : '/login'} className={current ? 'me on' : 'me'} aria-current={current ? 'page' : undefined}>
      {signedIn ? 'حسابي' : 'دخول الطلاب'}
      <span className="spare" aria-hidden="true">
        {signedIn ? 'دخول الطلاب' : 'حسابي'}
      </span>
    </Link>
  );
}

async function StudentLinkLive() {
  return <StudentLink signedIn={hasStudentCookie(await cookies())} />;
}

export function StudentNavLink() {
  return (
    <Suspense fallback={<StudentLink signedIn={false} />}>
      <StudentLinkLive />
    </Suspense>
  );
}
