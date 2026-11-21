import { connection } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * For an uptime monitor (and Railway's health check, if the hub points it here): 200 {"ok":true} when the site and its
 * database answer, 503 {"ok":false} when the database does not. Nothing else is returned: no version, no error text.
 * Runs at request time (connection()), never prerendered or cached.
 */
export async function GET() {
  await connection();
  const headers = { 'Cache-Control': 'no-store' };
  try {
    await (await getDb()).query('select 1');
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
