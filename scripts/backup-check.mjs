/**
 * Backup / restore check. Prints ONLY table names, row counts and the latest migration.
 * It never selects row data, so its output is safe to paste into a chat or a log.
 *
 *   DATABASE_URL=postgres://... node scripts/backup-check.mjs > counts-source.txt
 *   DATABASE_URL=postgres://... node scripts/backup-check.mjs > counts-restored.txt
 *   diff counts-source.txt counts-restored.txt && echo "restore matches"
 *
 * Point it at the throwaway database you restored into (or at the source for the "before" file).
 * The connection runs in a read-only transaction. The URL is never printed; on error only the
 * error code/message is shown (pg messages do not include the password).
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query('begin read only');
  const tables = (
    await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    )
  ).rows.map((r) => r.table_name);

  let latest = '(no schema_migrations table)';
  let migrationCount = 0;
  if (tables.includes('schema_migrations')) {
    const m = await client.query('select name from schema_migrations order by name');
    migrationCount = m.rows.length;
    latest = m.rows.length ? m.rows[m.rows.length - 1].name : '(none applied)';
  }

  console.log(`latest migration: ${latest} (${migrationCount} applied)`);
  console.log(`tables: ${tables.length}`);
  for (const t of tables) {
    // Identifier comes from the catalog; quote it anyway. Only count(*) is ever read.
    const id = '"' + t.replaceAll('"', '""') + '"';
    const r = await client.query(`select count(*)::text as n from ${id}`);
    console.log(`${t}\t${r.rows[0].n}`);
  }
  await client.query('rollback');
} catch (e) {
  console.error(`backup-check failed: ${e && e.code ? e.code + ' ' : ''}${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
