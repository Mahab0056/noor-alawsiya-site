# Backup and restore of the Postgres database

> **ملخص بالعربي.** قاعدة البيانات تحوي أسماء قاصرين وسنوات ميلادهم وأرقام هواتفهم وموافقات أولياء الأمور. هذا الملف يشرح
> طبقتين من النسخ الاحتياطي: (أ) نسخ Railway المدمجة على الـ volume، و(ب) نسخة منطقية أسبوعية `pg_dump` تُشفَّر فوراً بـ `age`
> وتُحفظ خارج Railway لمدة 30 يوماً. المفتاح الخاص يبقى عند محب بلا اتصال. ثم تمرين استعادة على قاعدة مؤقتة جديدة وفحص عدد الصفوف
> بالسكربت `scripts/backup-check.mjs` (يطبع أسماء الجداول وأعدادها فقط). لا شيء من البيانات ولا الروابط ولا المفاتيح يدخل سجلاً أو محادثة.
> نقطتان تحتاجان قرار محب: أين تُخزَّن النسخ المشفّرة، وهل تُفعَّل ميزة Railway المدفوعة (إن كانت مدفوعة).
> **مهم:** `APP_SECRET` لا يوجد في أي نسخة. بدونه لا تُفكّ أسرار TOTP المخزّنة للمدراء، فاحفظه منفصلاً (انظر 4).

Audience: the hub operator. Written 19/11/2026 against Phase 2 (`db/migrations/0001…0006`).
Nothing here was run against Railway or any production database; the cycle was proved only on throwaway local databases
(see section 8).

## 0. What is in the database (why this matters)

Per `db/migrations`: `students` (full name, birth year, phone, password hash, guardian name, guardian phone, guardian consent time),
`registrations` + `registration_answers`, `admins` (hashed password, TOTP secret **sealed with `APP_SECRET`**), `sessions` (token hashes),
`login_attempts` / `registration_attempts` / `invite_attempts` (client IPs), `audit_log`. A dump is therefore **as sensitive as the live database**.

## 1. What Railway publishes (docs seen 19/11/2026)

Sources: <https://docs.railway.com/volumes/backups>, <https://docs.railway.com/databases/postgresql>, <https://docs.railway.com/pricing/plans>.

Published:
- Backups are a **volume** feature, set in the service's settings panel → **Backups** tab; several schedules per volume can be on at once.
  - Daily: every 24 h, kept **6 days**. Weekly: every 7 days, kept **27 days**. Monthly: every 30 days, kept **89 days**.
- Restore: service → **Backups** tab → find the backup by date stamp → **Restore** (seconds to minutes) → **Details** at the top of the project canvas
  (review staged changes) → **Deploy**. The restored volume is mounted in the same place, named with the backup's date stamp; the old volume stays
  in the project unmounted. Backups restore only into the **same project and environment**.
- Backups are incremental / copy-on-write; you pay only for data unique to them, per GB per minute, at the same rates as volumes
  (volume storage listed at **$0.15 per GB per month**). Manual backups are capped at 50 % of the volume size.
- **Wiping a volume deletes all its backups.** So Railway backups die with the volume/project: they are not an off-platform copy.
- The Postgres article recommends regular backups and mentions point-in-time recovery and high availability as options.
- Public access: service → Settings → Networking → Public Access creates a **TCP Proxy** and sets `DATABASE_PUBLIC_URL`. Traffic through it is billed as
  egress (listed at **$0.05 per GB**). The article contains no `pg_dump` / `pg_restore` guidance.

**غير منشور (not published, as of the date above):**
- Which plans (Hobby / Pro / trial) include Backups, and whether the feature is free or paid on this account: the pricing page does not say.
- The exact price of backup storage beyond "same rates as volumes".
- Whether a backup is crash-consistent or application-consistent for Postgres, and whether point-in-time recovery needs a paid add-on.
- Which Postgres major version the Railway image runs (read it from the service, see 3.1; `pg_dump` must be the same major or newer).
- Any `pg_dump` over the TCP proxy recommendation, size limit, or timeout.

→ Read these on the live dashboard (Mahab / hub) before relying on them. Do not assume.

## 2. (a) Railway built-in backups: exact clicks

1. Railway → project `noor-alawsiya-com` → the **Postgres** service → **Backups** tab (if the tab is absent or says to upgrade, that answers the plan question).
2. Enable **Daily** and **Weekly** (and **Monthly** if the price shown is acceptable). Note the price the dashboard shows before confirming: Mahab decides.
3. Write down, in the hub notes (not in a repo, no URLs): schedule, retention shown, date turned on.
4. Restore drill for this layer (do it once, in a **copy** environment, never over production): follow the clicks in section 1; afterwards run the count check of section 5 against the restored database.
   A restored volume is mounted as a *new* volume: check the service is healthy before deleting the old one.

This layer protects against a bad deploy or an accidental delete inside Railway. It does **not** protect against losing the project/account (backups are deleted with the volume).

## 3. (b) Weekly logical backup, encrypted at once, stored off Railway

### 3.1 One-time setup (Mahab + hub)
1. **Keys.** On an offline machine run `age-keygen -o noor-backup.key`. It prints a public key `age1…`.
   - The **public key** (one line) goes in the repo as `docs/backup-age-recipient.txt` (a public key is not a secret). This file does not exist yet.
   - The **private key file** `noor-backup.key` stays with Mahab **offline** (two copies on separate media). It is never put on Railway, in CI, in a repo, in chat, or on the hub's backup machine.
   - Losing the private key = every backup is unreadable. Run the drill (section 5) before the first real backup is trusted.
2. **Client tools** on the backup machine: `pg_dump`/`pg_restore` of the **same major version or newer** than the server (`pg_dump --version`; the server: `select version()`), and `age` 1.2 or newer.
3. **Connection string.** Public Access must be on for the Postgres service (section 1; egress is billed). Put `DATABASE_PUBLIC_URL` in the backup machine's secret store / environment as `BACKUP_DATABASE_URL`. Never type it into a chat, a ticket, synced shell history or a log. Turn Public Access off again if backups run from inside Railway instead.
4. **Storage (not decided, see section 7).** Options: (1) an S3-compatible bucket at another provider with versioning + a 30-day lifecycle rule (Backblaze B2, Cloudflare R2, Wasabi…); (2) an external disk or NAS at the school/hub office; (3) a private cloud-drive account owned by Mahab. Files are already encrypted with `age`, so the store only needs to be reliable and separate from Railway; it still must not be public.

### 3.2 Weekly run (hub)
The dump is piped straight into `age`: **no plaintext dump ever touches disk.**

```sh
set -euo pipefail
STAMP=$(date -u +%Y%m%d-%H%M)
OUT="noor-db-$STAMP.dump.age"
RECIPIENT=$(cat docs/backup-age-recipient.txt)          # public key only
pg_dump -Fc --no-owner --no-privileges "$BACKUP_DATABASE_URL" | age -r "$RECIPIENT" -o "$OUT"
test -s "$OUT"                                          # non-empty
sha256sum "$OUT" > "$OUT.sha256"
# upload "$OUT" and "$OUT.sha256" to the chosen store (decided by Mahab)
```

Rules: no `set -x`, no `echo $BACKUP_DATABASE_URL`, no `--verbose` output pasted anywhere. Do not email or chat the file.
On Windows use Git Bash or `cmd /c "pg_dump … | age …"`: Windows PowerShell 5.1 re-encodes binary pipes and corrupts the dump.

### 3.3 Retention (30 days) and deletion
- Keep every file 30 days. Prefer a **store-side lifecycle rule** (delete objects older than 30 days) so deletion does not depend on a person.
- Manual deletion (if no lifecycle rule): list files by name, delete those whose `YYYYMMDD` is older than 30 days (`.age` and `.sha256` together), list again and confirm. Never delete the newest two, and never delete if the last restore drill failed.
- Erasure requests: the live row is deleted by the school's normal process; old backups age out within 30 days.
- Delete throwaway restore databases and any decrypted dump after each drill (section 5).

## 4. What is NOT in the dump
- `APP_SECRET` (Railway variable of service `site`). `admins.totp_secret` / `totp_pending_secret` are sealed with a key derived from it (`lib/auth.ts` `deriveKey`). Restore a database **without** the same `APP_SECRET` and admins cannot sign in with their authenticator; they would have to be re-invited. Keep `APP_SECRET` in a password manager owned by Mahab, separate from the age key.
- Other Railway variables (Resend key, etc.): same rule, a password manager, not the backup.
- Roles/ownership: dumps use `--no-owner --no-privileges` so they restore into any database user.

## 5. (c) Restore drill (new throwaway Postgres, never the live one)

Do this after setup, after any migration, and at least quarterly. It needs the private key: use Mahab's offline machine or have Mahab present.

1. Start a **new empty** Postgres (same major as production or newer): local `initdb`, Docker `postgres:17`, or a new Railway service in a *scratch* project. Create an empty database. Never point it at the live `DATABASE_URL`.
2. Get the newest `noor-db-*.dump.age` + `.sha256` from the store; `sha256sum -c` it.
3. Decrypt and restore in one pipe (no plaintext on disk):
   ```sh
   age -d -i noor-backup.key noor-db-YYYYMMDD-HHMM.dump.age | pg_restore --no-owner --no-privileges --exit-on-error -d "$DRILL_DATABASE_URL"
   ```
4. **Row-count check per table.** The live DB keeps changing, so take the source counts right when the dump was taken (pause registration for the minute) or accept small differences only in the append-only tables `sessions`, `login_attempts`, `registration_attempts`, `invite_attempts`, `audit_log` and explain them.
   ```sh
   DATABASE_URL="$BACKUP_DATABASE_URL" node scripts/backup-check.mjs > counts-source.txt
   DATABASE_URL="$DRILL_DATABASE_URL"  node scripts/backup-check.mjs > counts-restored.txt
   diff counts-source.txt counts-restored.txt && echo "restore matches"
   ```
   The script prints the latest migration, table names and counts only (read-only transaction, no row data, never prints the URL). `npm install` provides its only dependency (`pg`).
5. Optional: `DATABASE_URL="$DRILL_DATABASE_URL" npm run migrate` should say `nothing to apply`.
6. Cleanup: drop the drill database, stop/delete the scratch Postgres, make sure no plaintext dump exists (`find . -name '*.dump'`).
7. Record in the hub notes: date, backup file name, result (match / differences). Not the data.

A real disaster restore uses the same steps into a fresh production-grade Postgres, then `DATABASE_URL` is pointed at it and the same `APP_SECRET` is set. That is a decision for Mahab, not a drill.

## 6. (d) What never goes into a backup log, a chat, a ticket or a PR comment
- `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `BACKUP_DATABASE_URL`, any password, `APP_SECRET`, the age **private** key, Resend / API keys.
- Any dump file, plaintext or encrypted, and any row (names, phones, birth years, guardian data, IPs, TOTP secrets, session/token hashes).
- Screenshots of the Railway Variables tab or of `psql` output.
- Allowed in logs/chat: file names, sizes, sha256, table names, row counts, migration names, pass/fail, timings. `scripts/backup-check.mjs` output is safe by design.
- If a secret leaks anyway: rotate it (DB password in Railway; `APP_SECRET` with a re-invite plan; age key = new key, and old files stay readable only with the old key) and tell Mahab.

## 7. Questions for Mahab (not decided by this lane)
1. Where do the encrypted weekly files go (3.1 options: other-provider bucket, school NAS/disk, personal private drive)? Who owns/pays the account?
2. Turn on Railway's own backups? The docs do not state whether it is free on this plan; the dashboard's Backups tab shows the price. Volume rate is $0.15/GB-month for stored incremental data.
3. Who is the hub operator for the weekly run, and who holds the second copy of the private key?

## 8. Proof run (throwaway, invented data, 19/11/2026)
Postgres 17.6 (two throwaway instances on 127.0.0.1), `age` 1.3.2, throwaway key (deleted afterwards). Project head `bf49aa4` + this change.
`npm run migrate` (all six migrations) → seed + 6 invented students + 1 invented admin → `pg_dump -Fc` → `age` → decrypt → `pg_restore` into a second database →
`scripts/backup-check.mjs` on both: identical output (22 tables, latest migration `0006_admin_email_codes.sql`; e.g. `students 6`, `registrations 6`, `registration_answers 19`, `courses 20`, `admins 1`).
Also proved: the single-pipe form of 3.2 / 5.3; a different age key fails with `no identity matched any of the recipients`; the encrypted file starts with the `age-encryption.org` header.
