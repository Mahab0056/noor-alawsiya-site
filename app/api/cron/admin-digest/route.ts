import { adminDigestOn, digestTokenOk, runAdminDigest } from '@/lib/admin-digest';
import { getDb } from '@/lib/db';

/**
 * POST /api/cron/admin-digest with `Authorization: Bearer <ADMIN_DIGEST_TOKEN>`: sends today's digest to the super
 * admins once per Baghdad day (lib/admin-digest.ts). Flag ADMIN_DIGEST off, a missing or wrong token, or any other
 * method: the same bare 404, before the database is opened. The answer holds counts only, never an address.
 */

const notFound = () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function POST(request: Request) {
  if (!adminDigestOn() || !digestTokenOk(request.headers.get('authorization'))) return notFound();
  try {
    const result = await runAdminDigest(await getDb(), new Date());
    console.log(`admin-digest: ${JSON.stringify(result)}`);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error(`admin-digest failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    return Response.json({ status: 'error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

// Not a page: every other method gets the same 404, so the address looks like any unknown one.
export const GET = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
