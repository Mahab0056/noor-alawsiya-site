/**
 * Admin accounts from the command line.
 *
 * Production (and anywhere with DATABASE_URL): invite by e-mail. The invited admin sets their own password and turns
 * on their authenticator app from the link; nothing secret is ever printed here.
 *
 *   npm run create-admin -- --invite someone@example.com --role super      # super admin
 *   npm run create-admin -- --invite someone@example.com --role admin      # admin (reviews requests, edits the form)
 *   npm run create-admin -- --invite someone@example.com --role super --reset   # an active admin lost their phone
 *
 * Needs RESEND_API_KEY, APP_ORIGIN (and MAIL_FROM, default «نور الأوصياء <no-reply@barmjini.com>»). If any is missing,
 * or Resend refuses the message, the command fails and creates nothing. It never prints the link, the address or a key.
 *
 * Local development only (no DATABASE_URL): the old direct way, which prints the TOTP secret once.
 *
 *   ADMIN_PASSWORD='…' npm run create-admin -- "الاسم" email@example.com [super|owner|staff]
 */
import { createAdmin } from '../lib/accounts';
import { totpUri } from '../lib/auth';
import { getDb } from '../lib/db';
import { INVITE_HOURS, inviteAdmin, type InviteRole } from '../lib/invites';
import { mailConfig } from '../lib/mail';

const USAGE = 'Usage: npm run create-admin -- --invite email@example.com --role super|admin [--reset]';

async function invite(args: string[]) {
  const email = args[args.indexOf('--invite') + 1];
  const roleArg = args.includes('--role') ? args[args.indexOf('--role') + 1] : undefined;
  const role: InviteRole | null = roleArg === 'super' ? 'super_admin' : roleArg === 'admin' ? 'staff' : null;
  if (!email || email.startsWith('--') || !role) {
    console.error(USAGE);
    process.exit(2);
  }
  const mail = mailConfig(); // before the database is touched: a missing key creates nothing
  const db = await getDb();
  try {
    const { adminId, inviteId } = await inviteAdmin(db, { email, role, actorId: null, reset: args.includes('--reset') }, { mail });
    console.log(`Invite sent: admin #${adminId} (${role === 'super_admin' ? 'super admin' : 'admin'}), invite #${inviteId}. The link is only in the e-mail and works once, for ${INVITE_HOURS} hours.`);
  } finally {
    await db.close();
  }
}

async function direct(args: string[]) {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') {
    console.error('Direct creation prints a TOTP secret, so it is for the local development database only. Use --invite.\n' + USAGE);
    process.exit(2);
  }
  const [name, email, roleArg = 'staff'] = args;
  const role = roleArg === 'super' ? 'super_admin' : roleArg;
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!name || !email || (role !== 'owner' && role !== 'staff' && role !== 'super_admin') || !password) {
    console.error('Usage (local only): ADMIN_PASSWORD=… npm run create-admin -- "Name" email@example.com [super|owner|staff]');
    process.exit(2);
  }
  const db = await getDb();
  const { totpSecret } = await createAdmin(db, { name, email, password, role });
  console.log(`Admin created on the local database (${role}).`);
  console.log('Add this to an authenticator app now. It is not shown again:');
  console.log(`  secret: ${totpSecret}`);
  console.log(`  link:   ${totpUri(totpSecret, email)}`);
  await db.close();
}

const args = process.argv.slice(2);
(args.includes('--invite') ? invite(args) : direct(args)).catch((e) => {
  console.error(e instanceof Error ? e.message : 'Failed.');
  process.exit(1);
});
