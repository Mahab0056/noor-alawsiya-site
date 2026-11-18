/**
 * Creates an admin account with two-step verification.
 *
 *   ADMIN_PASSWORD='…' npm run create-admin -- "الاسم" email@example.com [owner|staff]
 *
 * The password comes from the environment so it does not land in shell history.
 * The TOTP secret is shown once: add it to an authenticator app straight away.
 */
import { createAdmin } from '../lib/accounts';
import { totpUri } from '../lib/auth';
import { getDb } from '../lib/db';

async function main() {
  const [name, email, role = 'staff'] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!name || !email || (role !== 'owner' && role !== 'staff') || !password) {
    console.error('Usage: ADMIN_PASSWORD=… npm run create-admin -- "Name" email@example.com [owner|staff]');
    process.exit(2);
  }
  const db = await getDb();
  const { totpSecret } = await createAdmin(db, { name, email, password, role });
  console.log(`Admin created: ${email} (${role})`);
  console.log('Add this to an authenticator app now. It is not shown again:');
  console.log(`  secret: ${totpSecret}`);
  console.log(`  link:   ${totpUri(totpSecret, email)}`);
  await db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
