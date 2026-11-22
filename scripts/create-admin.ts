/**
 * Creates an admin account. Login is by a six-digit code emailed to this address,
 * so there is no password to choose and nothing to copy into an authenticator app.
 *
 * npm run create-admin -- "الاسم" email@example.com [owner|staff]
 */
import { createAdmin } from '../lib/accounts';
import { getDb } from '../lib/db';

async function main() {
  const [name, email, role = 'staff'] = process.argv.slice(2);
  if (!name || !email || (role !== 'owner' && role !== 'staff')) {
    console.error('Usage: npm run create-admin -- "Name" email@example.com [owner|staff]');
    process.exit(2);
  }
  const db = await getDb();
  await createAdmin(db, { name, email, role });
  console.log(`Admin created: ${email} (${role})`);
  console.log('Sign in at /admin/login with this address; the login code arrives by email.');
  await db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
