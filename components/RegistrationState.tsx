import { connection } from 'next/server';
import { cache, Suspense } from 'react';
import { getDb } from '@/lib/db';
import { registrationCopy } from '@/lib/open-copy';
import { listOpenCourses } from '@/lib/registration';

/**
 * The registration line of the header strip and the home page, read from the database on each request (streamed into
 * the prerendered page, so the page itself stays static). If the database does not answer, the neutral wording is
 * shown instead of breaking the page.
 */
// React cache: the strip and the home page share one query per request.
const openCount = cache(async (): Promise<number | null> => {
  await connection();
  try {
    return (await listOpenCourses(await getDb())).length;
  } catch {
    return null;
  }
});

async function StripLive() {
  const { strip } = registrationCopy(await openCount());
  return strip ? <span className="sp">{strip}</span> : <span className="sp" />;
}

export function RegistrationStrip() {
  return (
    <Suspense fallback={<span className="sp" />}>
      <StripLive />
    </Suspense>
  );
}

function CtaText({ count }: { count: number | null }) {
  const { title, text } = registrationCopy(count);
  return (
    <div>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

async function CtaLive() {
  return <CtaText count={await openCount()} />;
}

export function RegistrationCta() {
  return (
    <Suspense fallback={<CtaText count={null} />}>
      <CtaLive />
    </Suspense>
  );
}
