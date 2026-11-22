# «الرسوم» and «حصة تجريبية» on the course page: design spec

Lane `awsiya-dev-fees-trial-design-2120`, 22/11/2026. Design only: this folder adds no app code and no migration.

- Look read from the release candidate `1b6b1bd` (`app/globals.css`, `app/site.css`, `app/forms.css`, the «الدورات» admin screen).
- The course page itself (`app/courses/[slug]/page.tsx`) is not on the RC yet. It is on `wave/awsiya-review-dev-five-2202-20261122` @ `92c3bfb`. The boards are drawn on a real prerendered page from that build, so **the build lane should cut from a base that has the course page**.
- The school has not answered the fees and trial questions. Until it does, every course shows «غير مذكور». Numbers on the boards are invented and each board says so in its top bar.

Files here:

| File | What it is |
|---|---|
| `SPEC.md` | this file |
| `fees-trial.css` | the proposed CSS, ready to append to `app/site.css` (the last rule belongs to the admin screen) |
| `boards/*.png` | 18 boards (list in §9) |
| `checks.json` | the result of the 32 page × width checks |
| `tools/` | the scripts that build the mock-up pages and shoot the boards (§10), and the migration check (§5) |

## 1. Principles

1. **A stated fact is strong, a missing fact is quiet.** A fee the school gave sits in a black panel with a yellow figure. «غير مذكور» sits in a dashed ivory panel. Nothing missing is ever drawn in yellow.
2. **A missing fact still gives the parent a next step.** Each «غير مذكور» has one WhatsApp button with the question already written. The visitor sends it; the site sends nothing and stores nothing.
3. **No holes on the page.** When both facts are missing, one card says so in two rows with one button, instead of two half-empty cards.
4. **No new colour, no new component family.** Only the v2 tokens (`--k`, `--y`, `--y-soft`, `--line`, `--mute`, `--ok`, `--warn`) and the existing `.card`, `.tag`, `.btn`.

## 2. Where the blocks go

Inside `.cpage`, in this DOM order: `.cfacts` (exists), **fees**, **trial** (or the waitlist block), `.cshare` (exists). No change to the `.cpage` grid.

| Width | Result |
|---|---|
| 375 | one column: facts and «سجّل», fees, trial, share |
| 768 | one column; inside each card the answer sits beside its rows or its button |
| 1440 | two columns as today: row 1 = facts, fees; row 2 = trial, share |

The inner layout follows the card's own width (`@container`, 600 px), so the fees card in the 468 px desktop column looks like the phone card. A browser without container queries keeps the stacked phone layout at every width.

Facts that are known also appear as plain `.tag`s in `.ctags`, beside the course name, so a parent sees them before scrolling: «مجانية» or «٢٥٬٠٠٠ دينار شهرياً», and «حصة تجريبية متاحة». A missing fact adds no tag. The tags are not links.

## 3. Which block shows when

Inputs: the record status (`lib/data.ts`), `accepting` (published and open in the database), `fee_kind`, `trial_kind`.

| Course | Fees block | Second block |
|---|---|---|
| Record status `done` or `unknown` | none | none |
| Database not readable (`getPublicCourses()` returns null) | none | none |
| Accepting, both facts missing | one merged card «الرسوم والحصة التجريبية» | (merged) |
| Accepting, at least one fact known | fees card in its state | trial card in its state |
| Not accepting, not finished | fees card in its state | «التسجيل مغلق الآن» with the waitlist, whatever `trial_kind` is |

Why the database-down row shows nothing: the facts live in the database, so «غير مذكور» there could be false.

## 4. The blocks and their copy

All copy is Modern Standard Arabic. `{course}` is the course name. Board for every state: `boards/states-1440.png`.

### 4.1 «الرسوم»

| State | When | Panel | Rows | Action |
|---|---|---|---|---|
| Stated | `fee_kind = 'paid'`, amount set | black: **٢٥٬٠٠٠** دينار عراقي, then «شهرياً» or «للدورة كاملة» | «طريقة الدفع», «ملاحظة» (each only if filled) | none |
| Free | `fee_kind = 'free'` | black: **مجانية**, then «لا رسوم على هذه الدورة.» | «ملاحظة» if filled | none |
| Paid, no amount | `fee_kind = 'paid'`, amount empty | dashed: **برسوم**, then «المبلغ غير مذكور.» | as stated | «اسأل المدرسة عن الرسوم» |
| Missing | `fee_kind` null | dashed: **غير مذكور**, then «لم تذكر المدرسة رسوم هذه الدورة بعد.» | none | «اسأل المدرسة عن الرسوم» |

- Heading: «الرسوم». Last line when anything is stated: «آخر تحديث: ٢٢ تشرين الثاني ٢٠٢٦» (`formatDate` of `info_updated_at`, `lib/format.ts:7`).
- The amount: `Intl.NumberFormat('ar-EG')` with grouping («٢٥٬٠٠٠»), the words «دينار عراقي» in the block and «دينار» in the tag.

### 4.2 «حصة تجريبية»

| State | When | Head tag | Body | Action |
|---|---|---|---|---|
| Available | `trial_kind = 'offered'` | `.tag.ok` «متاحة» | «تتيح المدرسة حصة تجريبية في هذه الدورة.» Rows: «الموعد» (the text, or «غير مذكور»), «ملاحظة» if filled | `.btn.k` «احجز حصة تجريبية على واتساب», then the hint |
| Not offered | `trial_kind = 'none'` | `.tag` «غير متاحة» | «لا تتوفر حصة تجريبية في هذه الدورة.» Row «ملاحظة» if filled | none |
| Missing | `trial_kind` null | none | dashed panel: **غير مذكور**, «لم تذكر المدرسة بعد هل تتوفر حصة تجريبية في هذه الدورة.» | «اسأل المدرسة عن الحصة التجريبية» |

Hint under the booking button: «يفتح الزر واتساب برسالة جاهزة إلى المدرسة، وأنت ترسلها. لا يحفظ الموقع رقمك.»

Booking in version 1 is a WhatsApp link, the same way the site already hands every conversation to the school's WhatsApp. It needs no table, no new personal data and no privacy change. A booking form with a time picker is listed under «later» (§8).

### 4.3 Both missing (the state that ships first)

One card, heading «الرسوم والحصة التجريبية», two rows («الرسوم: غير مذكور», «حصة تجريبية: غير مذكور»), one button «اسأل المدرسة عنهما على واتساب», and this line under it:

> «غير مذكور» تعني أن المدرسة لم تذكر المعلومة بعد. يفتح الزر واتساب برسالة جاهزة، وأنت ترسلها.

### 4.4 Registration closed: the waitlist

Heading «التسجيل مغلق الآن», bell icon. Text: «لا تستقبل هذه الدورة طلبات تسجيل ولا حجز حصة تجريبية الآن. اترك رقم واتساب ولي الأمر، وتراسلك المدرسة عند فتح التسجيل.» Button (a `<summary>` drawn as `.btn.k`): «أبلِغوني عند فتح التسجيل». It opens `WaitlistForm` of PR #3 in place, with `course` fixed (`components/WaitlistForm.tsx` at `ce2ab94`). Boards: `04-waitlist-*.png` (closed), `05-waitlist-open-375@2x.png` (open).

This block needs PR #3. Until PR #3 is merged, the closed state shows the fees card only, and the page keeps its existing «اسأل المدرسة على واتساب».

### 4.5 The ready WhatsApp messages

Link: `CONTACT.whatsapp` + `?text=` + `encodeURIComponent(message)`, `target="_blank" rel="noopener noreferrer"`.

| Button | Message |
|---|---|
| «اسأل المدرسة عن الرسوم» | السلام عليكم، أودّ السؤال عن رسوم «{course}». |
| «اسأل المدرسة عن الحصة التجريبية» | السلام عليكم، هل تتوفر حصة تجريبية في «{course}»؟ |
| «اسأل المدرسة عنهما على واتساب» | السلام عليكم، أودّ السؤال عن رسوم «{course}»، وهل تتوفر فيها حصة تجريبية؟ |
| «احجز حصة تجريبية على واتساب» | السلام عليكم، أرغب في حجز حصة تجريبية في «{course}». |

## 5. Admin fields (one migration)

Nine nullable columns on `courses`: eight are form inputs and one is a timestamp the server sets. No new table, no personal data. `null` in a `*_kind` column means «غير مذكور», so existing rows need no backfill and every course starts as «غير مذكور».

| Column | Type | Optional | Check | Admin label | Hint under the field |
|---|---|---|---|---|---|
| `fee_kind` | `text` | yes (null = غير مذكور) | `in ('free', 'paid')` | «الرسوم»: غير مذكور / مجانية / برسوم | none |
| `fee_amount_iqd` | `integer` | yes | `between 1 and 10000000`; only when `fee_kind = 'paid'` | «المبلغ بالدينار العراقي» | «أرقام فقط، مثل 25000. اتركه فارغاً إن لم يُعلن المبلغ.» |
| `fee_period` | `text` | required when the amount is set, else null | `in ('month', 'course')` | «المبلغ عن»: شهرياً / للدورة كاملة | «يلزم عند كتابة مبلغ.» |
| `fee_pay` | `text` | yes | 1 to 120 characters; only when `fee_kind = 'paid'` | «طريقة الدفع (اختياري)» | «حتى ١٢٠ حرفاً.» |
| `fee_note` | `text` | yes | 1 to 200 characters; only when `fee_kind` is set | «ملاحظة عن الرسوم (اختياري)» | «حتى ٢٠٠ حرف، مثل ما تشمله الرسوم.» |
| `trial_kind` | `text` | yes (null = غير مذكور) | `in ('offered', 'none')` | «الحصة التجريبية»: غير مذكور / متاحة / غير متاحة | none |
| `trial_when` | `text` | yes | 1 to 80 characters; only when `trial_kind = 'offered'` | «موعد الحصة التجريبية (اختياري)» | «كما تكتبه المدرسة، حتى ٨٠ حرفاً.» |
| `trial_note` | `text` | yes | 1 to 200 characters; only when `trial_kind` is set | «ملاحظة عن الحصة (اختياري)» | «حتى ٢٠٠ حرف.» |
| `info_updated_at` | `timestamptz` | set by the server | none | not a field | none |

Sketch of the migration, to be numbered at build time. The two shape constraints were run on PGlite with 19 rows (`tools/migration-check.mjs`): each row is accepted or refused as designed. The `coalesce` matters: a plain `fee_kind = 'paid' or …` is null for a null kind, and a check passes on null. `0008` is reserved for funnel-counts, `0010` is the waitlist, and `0009` has two claimants (see §11):

```sql
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
    and (trial_kind is not null or trial_note is null));
```

Admin screen (`app/admin/courses/page.tsx`), board `boards/admin-1440.png`:

- Each row gets a button «الرسوم والحصة» that opens the form for that course. A page `/admin/courses/[id]` is the simplest fit; the list has no edit form today.
- Each row shows what is missing as `.tag.warn`: «الرسوم: غير مذكور», «الحصة التجريبية: غير مذكور». When a fact is set the row shows it as plain muted text.
- The form is two fieldsets of three radios. «برسوم» and «متاحة» reveal their extra fields. Choosing another radio clears the hidden fields on save.
- Super admins only, checked inside the action (`requireSuperAdmin`), like `setCourseOpenAction`. One audit line `course.info` by course id, with no field values. `updateTag(PUBLIC_COURSES_TAG)` after saving.
- Text fields: trim and collapse spaces as `validateCourse` does (`lib/courses.ts:56`); an empty string is stored as null.

## 6. Build notes

File and line numbers are on `92c3bfb`.

1. **Reading the facts.** `readPublishedCourses` (`lib/public-courses.ts:30-32`) returns only `published` rows, and closing a course sets `published = false` (`lib/courses.ts:43`). So a closed course's fees cannot reach the page today. Proposal: the read also returns the nine new columns for unpublished rows **whose name matches a record entry** (those courses are public already), and `matchCourses` gives the page a second map, record name to `{ accepting, fee…, trial… }`. A panel-added course that is not published stays hidden as now.
2. **Cache.** The facts travel in `getPublicCourses()` (`lib/public-courses-cache.ts:34`), so the course page stays prerendered and follows a save through the same tag.
3. **Page.** `app/courses/[slug]/page.tsx`: add the blocks between `.cfacts` (ends at line 106) and `.cshare` (line 108), and the tags inside `.ctags` before it closes at line 73. Suggested components: `CourseFees`, `CourseTrial`, `CourseInfoMissing`, `CourseWaitlist`. All are server components except the PR #3 form.
4. **Icons.** Two new entries for `lib/icons.ts`: `cash` and `trial` (paths in `tools/build-mock.mjs`, `IC`). `bell` and `msg` exist.
5. **CSS.** Append `fees-trial.css` to `app/site.css`. Its last rule raises `.qrow .sp .btn.sm` to 44 px on every width (see §11 L2).
6. **Courses without their own page.** Courses added in the panel appear only under «دورات جديدة» on `/courses` (`COURSE_PAGES` is built from the record, `lib/share.ts:53`). Show the same known-fact tags there, beside «التسجيل مفتوح», or the first course with real fees (a new one is the likely case) will show them nowhere.
7. **Structured data, optional.** `coursesLd` (`lib/seo.ts:34`) may add `offers` with `price` and `priceCurrency: 'IQD'` when the fee is stated or free. Leave it out when the fee is missing.
8. **Tests to add.** The rule table of §3 as a pure function; the two shape constraints; the action refuses a staff admin; no fee text appears for an unpublished panel course; the amount prints with Arabic-Indic digits.

## 7. Accessibility and acceptance

Measured by `tools/shots.mjs` on 8 mock-up pages at 320, 375, 768 and 1440 px: **32 of 32 checks pass** (`checks.json`).

- **Contrast AA.** Lowest text pair in or beside the new blocks is 5.01:1. Pairs measured:

| Text | Background | Ratio | Where |
|---|---|---|---|
| `#17753a` | `#e3f3e8` | 5.01 | `.tag.ok` «متاحة» (existing token pair) |
| `#8f5600` | `#fff1cf` | 5.35 | `.tag.warn` in the admin row (existing pair) |
| `#66635a` | `#fbfaf3` | 5.74 | the line inside a dashed panel |
| `#66635a` | `#ffffff` | 6.00 | hints, labels, «آخر تحديث» |
| `#d5d5d5` | `#0b0b0c` | 13.40 | «شهرياً» in the black panel |
| `#fffa00` | `#0b0b0c` | 17.73 | the figure |
| `#17171a` | `#ffffff` | 17.89 | body text |

  axe-core 4.10.3 (WCAG 2 A/AA, 2.1 AA, 2.2 AA): 0 violations on every page and width. axe cannot judge text over the patterned black panel, so those pairs are in the table above against the solid `#0b0b0c`; the pattern is a 9 % yellow line.
- **Taps.** Every control in the blocks is at least 48 px high; the admin row buttons are 44 px. The one smaller target is the «سياسة الخصوصية» link inside the consent sentence of the PR #3 form (22 px, a link inside a sentence).
- **No sideways scroll** at 320, 375, 768 and 1440.
- **RTL.** `dir="rtl"`, logical properties only (`margin-inline-start`, `padding-inline-start`).
- **Screen readers.** Each block is a `<section aria-labelledby>` with an `h2`. «غير مذكور» is text, not colour alone. The state tag sits inside the block's header. Icons are `aria-hidden`.
- **MSA copy.** All strings in §4 and §5. The only dialect on the boards is inside the PR #3 form, shown as it is today (§11 L1).
- **No invented school facts.** The product strings contain no number, day, age or price. Filled states exist only on boards marked «للعرض فقط».

## 8. Not in version 1

- A booking form with a time picker for the trial class (new table, guardian phone, privacy text, admin inbox).
- More than one fee line per course (registration fee, books, sibling discount as data). `fee_note` carries these as text for now.
- Fee or trial facts on the six home cards.

## 9. Boards

`@2x` files are 750 px wide for a 375 px page. All boards stop at the end of `<main>`; the footer is unchanged.

| Board | Shows |
|---|---|
| `01-unknown-375@2x.png`, `-768`, `-1440` | the state that ships first: merged «غير مذكور» card, real course from the record. Registration is drawn open for the board only |
| `02-filled-375@2x.png`, `-768`, `-1440` | fee stated + trial available, with the head tags |
| `03-free-no-trial-375@2x.png`, `-768`, `-1440` | free course + no trial |
| `04-waitlist-375@2x.png`, `-768`, `-1440` | registration closed: fees missing + waitlist block, closed |
| `05-waitlist-open-375@2x.png` | the same with the PR #3 form open and a stated fee |
| `06-mixed-375@2x.png` | paid with no amount + trial available with no time |
| `states-1440.png`, `states-375@2x.png` | every state of each block at phone card width |
| `admin-1440.png`, `admin-375@2x.png` | the admin row tags and the form, empty and filled |

## 10. Rebuilding the boards

```sh
# 1. a folder with one real prerendered course page and its assets, from a build of 92c3bfb or later
mkdir -p site/_next/static/chunks site/img
cp .next/server/app/courses/narjis-2026.html site/
cp -r .next/static/media site/_next/static/ && cp .next/static/chunks/*.css site/_next/static/chunks/
cp public/img/mark-*.png public/img/icon-192.png site/img/
# 2. pages, then boards and checks
node docs/design/fees-trial/tools/build-mock.mjs site
NODE_PATH=<folder with playwright-core and axe-core> CHROME=<chromium> \
  node docs/design/fees-trial/tools/shots.mjs site docs/design/fees-trial/boards report.json
```

`tools/pr3-waitlist.css` is a copy of the PR #3 form rules, for the mock-up only. `tools/board.css` styles the bar above each board.

## 11. Findings for the build and review lanes

- **M1. A closed course's facts cannot be read publicly today** (`lib/public-courses.ts:30-32`, `lib/courses.ts:43`). See §6.1. Without it the closed state cannot show fees.
- **M2. Panel-added courses have no page of their own** (`lib/share.ts:53`). See §6.6.
- **M3. The base.** The course page is on `92c3bfb`, not on the RC `1b6b1bd`. The waitlist block also needs PR #3 (`ce2ab94`).
- **L1. PR #3 copy is partly Iraqi dialect** («ما أريد أحدد», «حتى تبلّغني لما تنفتح دورة», «بلّغوني لما تنفتح»), while the rest of the public site is MSA. This design's own button says «أبلِغوني عند فتح التسجيل». One wording should be chosen before both ship.
- **L2. Admin row buttons are 37 px high above 900 px** (`app/forms.css:106` gives `.btn.sm` 44 px only at 900 px and below). The proposed CSS raises the row buttons to 44 px.
- **L3. Migration `0009` has two claimants**: `0009_campaign_links.sql` on `92c3bfb`, and «0009 للدروس» in the header of `0010_waitlist.sql` (PR #3). Number the new migration after both are settled.
- **L4. The top strip says «التسجيل مفتوح للدورات الحالية» on every page**, also on a closed course (visible on `04-waitlist-*.png`). Known open question from earlier lanes; not changed here.

## 12. What the school needs to answer

Per course that takes registrations:

1. Is the course free or paid? If paid: how much, and is that per month or for the whole course? May the amount be shown on the site?
2. How is the fee paid?
3. Is there a trial class? If yes: which day and time, and is there anything the parent should know before coming?
