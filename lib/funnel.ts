import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { NAME_MAX, NAME_MIN, NAME_SHAPE } from './campaign-links';
import type { Db } from './db';

/**
 * Sign-up counters («صفحة التسجيل: آخر ٧ أيام» on /admin, numbers per link on «روابط الحملات»).
 *
 * One row per Baghdad day, step and source in funnel_daily (db/migrations/0008_funnel_daily.sql), and one upsert per
 * counted step. Nothing about the visitor is written anywhere: no cookie, no IP address, no device id, no time finer
 * than the day. The address is only used, in memory, to stop one connection from inflating the numbers, and even
 * there it is held as a keyed hash that changes on every restart.
 *
 * Behind FUNNEL_COUNTS (env), default off. Off: nothing is written, the form posts no source, /admin has no card and
 * «روابط الحملات» keeps its «لاحقاً» line. Counting never throws and never stops a registration.
 */

export const FUNNEL_STEPS = ['view', 'start', 'review', 'sent', 'saved'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
/** The steps the browser reports through countFunnelAction. `sent` and `saved` are counted by the server itself. */
export const CLIENT_STEPS = ['view', 'start', 'review'] as const;
export type ClientStep = (typeof CLIENT_STEPS)[number];

export const isStep = (v: unknown): v is FunnelStep => typeof v === 'string' && (FUNNEL_STEPS as readonly string[]).includes(v);
export const isClientStep = (v: unknown): v is ClientStep => typeof v === 'string' && (CLIENT_STEPS as readonly string[]).includes(v);

/** «بلا رابط» (no `?from=`) and «مصدر آخر» (a name that is not one of our links). Reserved in campaign_links. */
export const DIRECT = 'direct';
export const OTHER = 'other';

export function funnelOn(env: Record<string, string | undefined> = process.env) {
  return /^(1|true|on)$/i.test(env.FUNNEL_COUNTS?.trim() ?? '');
}

// ---------------------------------------------------------------- sources

/**
 * First pass, without the database. Missing or empty → `direct`; `direct` and `other` stand for themselves (the form
 * posts back the source the page worked out); anything not shaped like a link name (too long, Arabic, spaces, a
 * repeated `?from=` that arrives as a list, a number) → `other`. Otherwise the lowercased name, still to be looked up.
 */
export function sourceShape(raw: unknown): { fixed: typeof DIRECT | typeof OTHER } | { name: string } {
  if (raw === undefined || raw === null) return { fixed: DIRECT };
  if (Array.isArray(raw)) return raw.length === 0 ? { fixed: DIRECT } : { fixed: OTHER };
  if (typeof raw !== 'string') return { fixed: OTHER };
  if (raw.length > 64) return { fixed: OTHER }; // not worth trimming: no link of ours is that long
  const v = raw.trim().toLowerCase();
  if (v === '') return { fixed: DIRECT };
  if (v === DIRECT || v === OTHER) return { fixed: v };
  if (v.length < NAME_MIN || v.length > NAME_MAX || !NAME_SHAPE.test(v)) return { fixed: OTHER };
  return { name: v };
}

/**
 * The source a step is counted under: a name only if it is one of the links in «روابط الحملات» (campaign_links), so
 * a made-up `?from=` cannot add rows. Never throws: if the lookup fails the step counts as `other`.
 */
export async function normalizeSource(db: Db, raw: unknown): Promise<string> {
  const s = sourceShape(raw);
  if ('fixed' in s) return s.fixed;
  try {
    const [row] = await db.query('select 1 as ok from campaign_links where name = $1', [s.name]);
    return row ? s.name : OTHER;
  } catch {
    return OTHER;
  }
}

const SOURCE_OK = (s: string) => s.length >= NAME_MIN && s.length <= NAME_MAX && NAME_SHAPE.test(s);

// ---------------------------------------------------------------- days

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' });

/** `YYYY-MM-DD` in Baghdad (UTC+3 all year, no daylight saving). */
export const baghdadDay = (at: Date = new Date()) => DAY.format(at);

/** The first and last day of the `days` days ending today (Baghdad). */
export function lastDays(days: number, now: Date = new Date()) {
  return { from: baghdadDay(new Date(now.getTime() - (days - 1) * 86_400_000)), to: baghdadDay(now) };
}

// ---------------------------------------------------------------- counting

/** One upsert. Returns false instead of throwing on any problem (bad step, bad source, database error). */
export async function countStep(db: Db, step: FunnelStep, source: string, at: Date = new Date()): Promise<boolean> {
  if (!isStep(step) || typeof source !== 'string' || !SOURCE_OK(source)) return false;
  try {
    await db.query(
      `insert into funnel_daily (day, step, source, n) values ($1, $2, $3, 1)
       on conflict (day, step, source) do update set n = funnel_daily.n + 1`,
      [baghdadDay(at), step, source]
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * `saved`, inside the registration's own transaction: if the registration rolls back, so does the count. A savepoint
 * keeps a failed count (a missing table, a check) from aborting the transaction, so the registration is still stored.
 */
export async function countStepInTx(t: Db, step: FunnelStep, source: string, at: Date = new Date()): Promise<boolean> {
  try {
    await t.query('savepoint funnel_count');
  } catch {
    return false;
  }
  const ok = await countStep(t, step, source, at);
  try {
    await t.query(ok ? 'release savepoint funnel_count' : 'rollback to savepoint funnel_count');
  } catch {
    // nothing more to do: the registration's own statements decide whether it commits
  }
  return ok;
}

/**
 * What countFunnelAction (app/funnel-actions.ts) does, here so it can be tested without a request: the flag, the
 * step, the in-memory limit for the address, then the source and the upsert. Never throws; true if a row moved.
 */
export async function countBrowserStep(open: () => Promise<Db>, address: () => Promise<string>, step: unknown, from: unknown, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  try {
    if (!funnelOn(env) || !isClientStep(step)) return false;
    if (!allowCount(await address(), step)) return false;
    const db = await open();
    return await countStep(db, step, await normalizeSource(db, from));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- per-address limit (memory only)

/** Each browser step counts at most this many times per address per hour. Mobile carriers share one address between many phones, so it is not 1. */
export const PER_ADDRESS_PER_HOUR = 30;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_KEYS = 20_000;

/** Never written anywhere and never logged. The key is new on every start, so the hashes cannot be matched across restarts. */
const KEY = randomBytes(32);
const windows = new Map<string, { start: number; n: number }>();

const bucket = (address: string, step: ClientStep) => createHmac('sha256', KEY).update(`${step}\n${address}`).digest('base64url').slice(0, 22);

/** True if this step from this address may still be counted now. Fails closed when the table is full of fresh entries. */
export function allowCount(address: string, step: ClientStep, now: number = Date.now()): boolean {
  const key = bucket(address, step);
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    if (!w && windows.size >= MAX_KEYS) {
      for (const [k, old] of windows) if (now - old.start >= WINDOW_MS) windows.delete(k);
      if (windows.size >= MAX_KEYS) return false;
    }
    windows.set(key, { start: now, n: 1 });
    return true;
  }
  if (w.n >= PER_ADDRESS_PER_HOUR) return false;
  w.n += 1;
  return true;
}

/** Tests only. */
export const resetCountLimitsForTests = () => windows.clear();
/** Tests only: what the limiter holds (hashes and numbers, never an address). */
export const countLimitKeysForTests = () => [...windows.keys()];

// ---------------------------------------------------------------- reading

export type StepCounts = Record<FunnelStep, number>;
const zero = (): StepCounts => ({ view: 0, start: 0, review: 0, sent: 0, saved: 0 });

export type FunnelSummary = { days: number; from: string; to: string; totals: StepCounts; sources: { source: string; counts: StepCounts }[] };

async function bySource(db: Db, days: number, now: Date) {
  const range = lastDays(days, now);
  const rows = await db.query<{ source: string; step: FunnelStep; n: number | string }>(
    `select source, step, sum(n) as n from funnel_daily where day between $1 and $2 group by source, step`,
    [range.from, range.to]
  );
  const map = new Map<string, StepCounts>();
  for (const r of rows) {
    if (!isStep(r.step)) continue;
    const c = map.get(r.source) ?? zero();
    c[r.step] += Number(r.n);
    map.set(r.source, c);
  }
  return { range, map };
}

/** The /admin card: totals for the last `days` days and one line per source, the busiest first. */
export async function funnelSummary(db: Db, days = 7, now: Date = new Date()): Promise<FunnelSummary> {
  const { range, map } = await bySource(db, days, now);
  const totals = zero();
  for (const c of map.values()) for (const s of FUNNEL_STEPS) totals[s] += c[s];
  const sources = [...map.entries()]
    .map(([source, counts]) => ({ source, counts }))
    .sort((a, b) => b.counts.saved - a.counts.saved || b.counts.view - a.counts.view || a.source.localeCompare(b.source));
  return { days, ...range, totals, sources };
}

/** «روابط الحملات»: the counts of the last `days` days per link name (links with no visits are absent). */
export async function countsByLink(db: Db, days = 7, now: Date = new Date()): Promise<Map<string, StepCounts>> {
  const { map } = await bySource(db, days, now);
  map.delete(DIRECT);
  map.delete(OTHER);
  return map;
}
