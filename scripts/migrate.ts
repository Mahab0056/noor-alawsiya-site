/** Applies pending migrations. getDb() runs them on open, so this only opens the database and reports. */
import { getDb } from '../lib/db';

async function main() {
  const db = await getDb();
  const rows = await db.query<{ name: string }>('select name from schema_migrations order by name');
  console.log('migrations applied:', rows.map((r) => r.name).join(', '));
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
