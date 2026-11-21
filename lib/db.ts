import 'server-only';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Database access.
 *
 * - Production: Postgres through `pg`, from DATABASE_URL.
 * - Development and tests: PGlite (Postgres compiled to WASM, in-process). Nothing is left
 *   running, and it only ever holds invented data. PGLITE_DIR picks the folder
 *   (default `.pglite`); `memory://` keeps it in memory for tests.
 *
 * Production never falls back to PGlite: a missing DATABASE_URL is an error there.
 */

export type Row = Record<string, unknown>;

export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run several statements with no parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** Run `fn` in a transaction; rolls back if it throws. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

async function openPg(url: string): Promise<Db> {
  const mod = await import('pg');
  const pg = mod.default ?? mod;
  // bigint ids and count(*) arrive as text by default. Every id here is far below 2^53, so read them as numbers (PGlite does the same).
  pg.types.setTypeParser(20, Number);
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // An idle connection dropped by the server (restart, failover) is an 'error' event on the pool. Without a listener it is
  // an uncaught exception; the pool already discards that connection and opens a new one on the next query.
  pool.on('error', (e: Error & { code?: string }) => console.error(`database: idle connection lost (${e.code ?? 'no code'})`));
  type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  const wrap = (q: Queryable, inTx: boolean): Db => ({
    query: async <T extends Row>(text: string, params?: unknown[]) => (await q.query(text, params)).rows as T[],
    exec: async (sql) => void (await q.query(sql)),
    tx: async (fn) => {
      if (inTx) return fn(wrap(q, true));
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client, true));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  });
  const db = wrap(pool, false);
  // Several instances can start together: one holds the lock and migrates, the others wait and find nothing left to do.
  try {
    const lock = await pool.connect();
    try {
      await lock.query('select pg_advisory_lock(727001)');
      await migrate(db);
    } finally {
      await lock.query('select pg_advisory_unlock(727001)').catch(() => {});
      lock.release();
    }
  } catch (e) {
    await pool.end().catch(() => {}); // getDb() will try again with a new pool: do not leave this one open
    throw e;
  }
  return db;
}

async function openPglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = await PGlite.create(dir);
  type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (sql: string) => Promise<unknown> };
  const wrap = (q: Queryable, inTx: boolean): Db => ({
    query: async <T extends Row>(text: string, params?: unknown[]) => (await q.query(text, params)).rows as T[],
    exec: async (sql) => void (await q.exec(sql)),
    tx: (fn) => (inTx ? fn(wrap(q, true)) : lite.transaction((t) => fn(wrap(t as unknown as Queryable, true)))),
    close: () => lite.close(),
  });
  return wrap(lite as unknown as Queryable, false);
}

/** Apply every `db/migrations/*.sql` not yet recorded, in name order, each in its own transaction. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('insert into schema_migrations (name) values ($1)', [name]);
    });
    applied.push(name);
  }
  return applied;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return openPg(url);
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PGLITE !== '1') {
    throw new Error('DATABASE_URL is not set. Production does not fall back to the in-process development database.');
  }
  const db = await openPglite(process.env.PGLITE_DIR ?? path.join(process.cwd(), '.pglite'));
  await migrate(db);
  return db;
}

// One connection per process, surviving dev hot reloads.
const holder = globalThis as unknown as { __noorDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!holder.__noorDb) {
    const opening = open();
    holder.__noorDb = opening;
    // A failed first connection (the database restarting while the site starts) must not stick: forget it, so the next
    // request tries again. Before this, every request kept failing until the whole site was restarted.
    opening.catch(() => {
      if (holder.__noorDb === opening) holder.__noorDb = undefined;
    });
  }
  return holder.__noorDb;
}

/** Tests only: start from a fresh in-memory database. */
export async function resetDbForTests(): Promise<Db> {
  if (holder.__noorDb) await (await holder.__noorDb).close();
  // TEST_DATABASE_URL runs the same tests against a real, empty, throwaway Postgres. Its public schema is wiped first.
  const real = process.env.TEST_DATABASE_URL;
  if (real) {
    if (!/@(127\.0\.0\.1|localhost)[:/]/.test(real)) throw new Error('TEST_DATABASE_URL must point at a local throwaway database.');
    const mod = await import('pg');
    const pg = mod.default ?? mod;
    const c = new pg.Client({ connectionString: real });
    await c.connect();
    await c.query('drop schema public cascade; create schema public');
    await c.end();
    process.env.DATABASE_URL = real;
  } else {
    process.env.PGLITE_DIR = 'memory://';
    delete process.env.DATABASE_URL;
  }
  holder.__noorDb = open();
  return holder.__noorDb;
}
