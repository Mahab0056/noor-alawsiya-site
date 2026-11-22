import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { COURSES } from './data';
import { getDb } from './db';
import { matchCourses, readPublishedCourses, type PublicCourses } from './public-courses';

/** The admin «الدورات» actions expire this tag, so the public pages follow a change at once. */
export const PUBLIC_COURSES_TAG = 'public-courses';

// The first call in a process opens the pool and checks migrations under a lock: give that longer than a query.
const OPEN_WAIT_MS = 15_000;
const QUERY_WAIT_MS = 8000; // includes taking a pool connection, which may have to open a new one
// A null result (no database) is tried again after 15 s instead of a minute. Expire stays at 5 min so the page can
// still be prerendered (shorter-lived caches would make it dynamic).
const RETRY_SOON = { stale: 30, revalidate: 15, expire: 300 };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database did not answer in ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * Which courses take registrations now, for the public pages. Cached (and so part of the prerendered page) for about
 * a minute, and expired at once by the admin actions.
 *
 * Returns null when the database cannot be read: during `next build` (no database there, and a build must never
 * migrate the production database), when it is down, or when it is too slow (15 s to open, 8 s to query). The pages
 * then show the school record alone, with no badges, and the next request after 15 s tries again. Visitors do not
 * wait for this: a cached page is served while it is rebuilt in the background.
 */
export async function getPublicCourses(): Promise<PublicCourses | null> {
  'use cache';
  cacheTag(PUBLIC_COURSES_TAG);
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    cacheLife(RETRY_SOON);
    return null;
  }
  try {
    const db = await withTimeout(getDb(), OPEN_WAIT_MS);
    const view = matchCourses(COURSES, await withTimeout(readPublishedCourses(db), QUERY_WAIT_MS));
    cacheLife('minutes');
    return view;
  } catch (e) {
    console.error('public courses: database not readable, showing the record only:', e instanceof Error ? e.message : e);
    cacheLife(RETRY_SOON);
    return null;
  }
}
