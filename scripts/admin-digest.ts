/**
 * npm run digest: today's digest to the super admins, once per Baghdad day (lib/admin-digest.ts).
 * For a Railway cron service at 06:00 UTC (09:00 Baghdad); see README «الملخص اليومي للمديرين».
 *
 * ADMIN_DIGEST off: prints «off» and exits 0 without opening the database (so no migration and no write).
 * Prints counts only, never an address. Exit 1 when the digest could not be sent; the next run tries again.
 */
import { adminDigestOn, runAdminDigest } from '../lib/admin-digest';

async function main() {
  if (!adminDigestOn()) {
    console.log('admin-digest: off');
    return;
  }
  const { getDb } = await import('../lib/db');
  const db = await getDb();
  try {
    console.log(`admin-digest: ${JSON.stringify(await runAdminDigest(db, new Date()))}`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(`admin-digest failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  process.exit(1);
});
