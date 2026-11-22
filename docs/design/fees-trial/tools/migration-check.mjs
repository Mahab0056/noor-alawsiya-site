// The migration sketch of SPEC.md §5 against an in-memory PGlite: which rows the two shape constraints accept and refuse.
//   node docs/design/fees-trial/tools/migration-check.mjs   (from the repo root, after npm ci)
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`create table courses (id bigint generated always as identity primary key, name text not null);
alter table courses
  add column fee_kind        text check (fee_kind in ('free', 'paid')),
  add column fee_amount_iqd  integer check (fee_amount_iqd between 1 and 10000000),
  add column fee_period      text check (fee_period in ('month', 'course')),
  add column fee_pay         text check (char_length(fee_pay) between 1 and 120),
  add column fee_note        text check (char_length(fee_note) between 1 and 200),
  add column trial_kind      text check (trial_kind in ('offered', 'none')),
  add column trial_when      text check (char_length(trial_when) between 1 and 80),
  add column trial_note      text check (char_length(trial_note) between 1 and 200),
  add column info_updated_at timestamptz,
  add constraint courses_fee_shape check (
    (fee_amount_iqd is null) = (fee_period is null)
    and (coalesce(fee_kind = 'paid', false) or (fee_amount_iqd is null and fee_pay is null))
    and (fee_kind is not null or fee_note is null)),
  add constraint courses_trial_shape check (
    (coalesce(trial_kind = 'offered', false) or trial_when is null)
    and (trial_kind is not null or trial_note is null));`);
const cases = [
  ['all null', `default values`, true, null],
  ['free', `(name, fee_kind) values ('a','free')`, true],
  ['free + note', `(name, fee_kind, fee_note) values ('a','free','x')`, true],
  ['paid no amount', `(name, fee_kind, fee_pay) values ('a','paid','cash')`, true],
  ['paid amount+period', `(name, fee_kind, fee_amount_iqd, fee_period) values ('a','paid',25000,'month')`, true],
  ['paid amount no period', `(name, fee_kind, fee_amount_iqd) values ('a','paid',25000)`, false],
  ['period no amount', `(name, fee_kind, fee_period) values ('a','paid','month')`, false],
  ['free with amount', `(name, fee_kind, fee_amount_iqd, fee_period) values ('a','free',1,'month')`, false],
  ['null kind with amount', `(name, fee_amount_iqd, fee_period) values ('a',1,'month')`, false],
  ['null kind with pay', `(name, fee_pay) values ('a','cash')`, false],
  ['null kind with note', `(name, fee_note) values ('a','x')`, false],
  ['zero amount', `(name, fee_kind, fee_amount_iqd, fee_period) values ('a','paid',0,'month')`, false],
  ['bad kind', `(name, fee_kind) values ('a','donation')`, false],
  ['empty pay', `(name, fee_kind, fee_pay) values ('a','paid','')`, false],
  ['trial offered + when', `(name, trial_kind, trial_when, trial_note) values ('a','offered','sat','n')`, true],
  ['trial none + note', `(name, trial_kind, trial_note) values ('a','none','n')`, true],
  ['trial none + when', `(name, trial_kind, trial_when) values ('a','none','sat')`, false],
  ['null trial + when', `(name, trial_when) values ('a','sat')`, false],
  ['null trial + note', `(name, trial_note) values ('a','n')`, false],
];
let bad = 0;
for (const [label, sql, want] of cases) {
  let ok = true;
  try { await db.exec(`insert into courses ${sql.startsWith('default') ? "(name) values ('a')" : sql}`); } catch { ok = false; }
  if (ok !== want) bad++;
  console.log(ok === want ? 'PASS' : 'FAIL', label, '→', ok ? 'accepted' : 'refused');
}
console.log(bad ? `${bad} wrong` : `all ${cases.length} cases as designed`);
process.exit(bad ? 1 : 0);
