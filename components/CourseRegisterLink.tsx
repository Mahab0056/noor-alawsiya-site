'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { registerHref } from '@/lib/share-links';

/**
 * «سجّل» on a course page. The page itself is static; only this link reads `?from=` (in the browser) so a visitor
 * who came from a shared WhatsApp link lands on /register?course=…&from=wa and the counters see the source.
 * The course page wraps it in <Suspense> with the same link minus `from` as the fallback, so nothing moves.
 */
export function CourseRegisterLink({ course, label }: { course: string; label: string }) {
  const from = useSearchParams().get('from') ?? undefined;
  return (
    <Link className="btn y" href={registerHref(course, from)}>
      {label}
    </Link>
  );
}
