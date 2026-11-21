import 'server-only';
import type { Db } from './db';

/**
 * Retention for the short-lived security records. /privacy promises that sign-in and registration attempts are
 * deleted automatically after one day (app/privacy/page.tsx). Before this, rows older than a day were only deleted
 * when the NEXT attempt of the same kind arrived (lib/auth.ts reserveAttempt / allowRegistration), so on a quiet day
 * they stayed for as long as nobody tried again.
 *
 * pruneExpired deletes, in one cheap pass (each table has an index on created_at or expires_at, or is tiny):
 *   - login_attempts, registration_attempts, invite_attempts older than one day (phone or e-mail + client address);
 *   - sessions and remembered admin devices past their expiry;
 *   - admin e-mail sign-in codes older than one day (only an HMAC of the code is stored).
 * No row is read or logged; on failure only the Postgres error code is logged.
 */

export const ATTEMPT_RETENTION = '1 day';

const STATEMENTS = [
  `delete from login_attempts where created_at < now() - interval '${ATTEMPT_RETENTION}'`,
  `delete from registration_attempts where created_at < now() - interval '${ATTEMPT_RETENTION}'`,
  `delete from invite_attempts where created_at < now() - interval '${ATTEMPT_RETENTION}'`,
  `delete from admin_login_codes where created_at < now() - interval '${ATTEMPT_RETENTION}'`,
  'delete from sessions where expires_at < now()',
  'delete from admin_devices where expires_at < now()',
];

export async function pruneExpired(db: Db) {
  for (const sql of STATEMENTS) await db.query(sql);
}

/** At most once an hour per process, so a row lives one day plus at most an hour while the site gets any request. */
export const PRUNE_EVERY_MS = 3600_000;

const state = globalThis as unknown as { __noorPrunedAt?: number };

/**
 * Called on every getDb() inside the running Next server (lib/db.ts), including /healthz. Returns at once: the delete
 * runs in the background and never delays or fails the request. Returns whether a pass was started (for tests).
 */
export function maybePrune(db: Db, now = Date.now()): boolean {
  if (state.__noorPrunedAt !== undefined && now - state.__noorPrunedAt < PRUNE_EVERY_MS) return false;
  state.__noorPrunedAt = now;
  pruneExpired(db).catch((e: { code?: string }) => {
    console.error(`retention: prune failed (${e?.code ?? 'no code'})`);
    state.__noorPrunedAt = undefined; // try again on the next request
  });
  return true;
}

/** Tests only. */
export function resetPruneClockForTests() {
  state.__noorPrunedAt = undefined;
}
