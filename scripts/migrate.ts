/**
 * Applies pending migrations. Run it before every deploy that adds a file to db/migrations/.
 * getDb() migrates only the local PGlite database by itself; Postgres (DATABASE_URL) is migrated here and nowhere else.
 */
import { getDb, migrate } from '../lib/db';

async function main() {
  const db = await getDb();
  const applied = await migrate(db);
  console.log(applied.length ? `migrations applied now: ${applied.join(', ')}` : 'migrations: nothing to apply');
  const rows = await db.query<{ name: string }>('select name from schema_migrations order by name');
  console.log('migrations in the database:', rows.map((r) => r.name).join(', '));
  await db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
