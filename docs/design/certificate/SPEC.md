# «شهادة إتمام»: completion certificate, design spec

Lane `awsiya-dev-certificate-design-2208`, 22/11/2026. Design only: this folder adds no app code, no migration and no dependency.

- Look read from the release candidate `1b6b1bd`: `app/globals.css` (v2 tokens), `app/layout.tsx` (the three font families), `app/forms.css` (`.auth`, `.alert`, `.field`), `public/img/mark-*.png`.
- Every person and course on the boards is invented, and every board says so in a corner label. Only the school's name and city are real. A real certificate never carries that label.
- The school has not been asked yet who signs, what counts as completing a course, or whether it wants a Hijri date. Those are open (§12) and the design does not depend on the answers.

| File | What it is |
|---|---|
| `SPEC.md` | this file |
| `certificate.css` | the design itself: `.cert.a4` (paper) and `.cert.sq` (share image) |
| `mock/certificate.html` | the mock-up; opens from disk. `?s=` sample, `?f=a4\|sq`, `?grey=1`, `?nf=ruqaa`, `?nofit=1` |
| `mock/fit.js` | the name-fit rule as a pure function (§5); the build can port it line by line |
| `mock/samples.js`, `mock/qr.js` | invented data, and the QR matrix for the sample link |
| `mock/verify.html`, `mock/verify.css` | the verify page, drawn with the site's own CSS files plus 12 new rules |
| `fonts/` | the five TTF files the certificate uses, with their OFL licence texts |
| `pdf/*.pdf` | three A4 samples printed from the mock-up (fonts embedded) |
| `boards/*.png` | 34 boards (§10) |
| `checks.json` | the result of the acceptance checks (§9) |
| `tools/` | scripts: boards + checks, QR matrix, font facts, and the server-PDF probe (§7) |

## 1. Principles

1. **Black ink on white paper.** On A4 the paper is white and all text is `#0b0b0c`, `#17171a` or `#4a4842`. Yellow `#fffa00` is decoration only and every yellow shape has a black edge, so a grey or black-and-white print loses nothing (board `board-print-grey.png`).
2. **The screen version is the site.** The share image uses the site's own canvas: black with the star pattern, yellow title, white name, yellow band at the bottom.
3. **The name is never cut, squeezed or ended with «…».** It steps down in size, then goes to two lines. The layout under it does not move.
4. **Nothing the school did not say.** A missing fact is left out, never filled in. No grade, no «بتقدير», no hours, no Hijri date unless the school gives them.
5. **It is not an ijazah.** The title is «شهادة إتمام», the sentence is «لإتمام {course}», and the verify page says so in words. The word «إجازة» appears nowhere on the certificate.
6. **Same three families as the site**, nothing new: Aref Ruqaa (title), Amiri (name), IBM Plex Sans Arabic (everything else).

## 2. The sentence

Gender-neutral on purpose: the database has no gender field (`students` has `full_name`, `birth_year`, phone, guardian).

> **شهادة إتمام**
> تُمنح هذه الشهادة إلى
> **{name}**
> لإتمام
> **{course}**
> {kind} · من {start} إلى {end}

When the start is not known: «أُتمّت في {end}». When the kind is not known the «{kind} ·» part is dropped.

## 3. Fields

| Field | On A4 | On the square | Source today | Limit | If missing |
|---|---|---|---|---|---|
| Student name | yes | yes | `students.full_name` | 80 (`MAX_NAME`) | cannot be missing |
| Course name | yes | yes | `courses.name` | 120 (`MAX_COURSE_NAME`) | cannot be missing. Do not issue for «دورة غير مسمّاة في السجل» |
| Course kind | yes | yes | `courses.kind` → `kindLabel` | 38 today | left out |
| Start | yes | yes | `courses.started_on` (free text, as in the school record) | 60 (`MAX_COURSE_START`) | sentence changes to «أُتمّت في {end}» |
| End | yes | yes | **new**: `courses.ended_on date` | date | no certificate without it |
| Teacher(s) | yes, under the first signature line | no | `courses.teacher` (free text, may hold two names) | 120 | cannot be missing |
| Second signer | yes, «مدير المدرسة» | no | **new**: a school setting (name + title) | 80 | the second signature block is not drawn and the first takes the two columns (rule only; no board shows it) |
| School name, city | yes | yes | constant: «مدرسة نور الأوصياء للدراسات القرآنية», «بغداد» | | |
| Issue date | yes, last line | yes, in the band | **new**: `certificates.issued_at` | date | cannot be missing |
| Verify code | yes, as «رقم الشهادة» | inside the link | **new**: `certificates.code` | 8 characters | cannot be missing |
| Short link | yes, text + QR | yes, text only | derived: `noor-alawsiya.com/c/{code}` | | |

Dates are written by the site's `formatDate` (`lib/format.ts`): Gregorian, Iraqi month names, Arabic-Indic digits («١٢ أيلول ٢٠٢٦»).

What the build has to store (one migration, names are a proposal):

- `courses.ended_on date null`.
- `certificates`: `id`, `code text unique`, `student_id` (on delete cascade), `course_id`, **snapshots of what was printed** (`student_name`, `course_name`, `course_kind_label`, `started_on`, `ended_on`, `teacher`, `signer_name`, `signer_title`), `issued_at`, `issued_by`, `revoked_at`, `revoked_by`. Unique on (`student_id`, `course_id`) where `revoked_at is null`.
- The snapshot matters: a later edit to the course or to the student's name must not silently change a certificate that is already printed and shared. A wrong name is fixed by revoking and issuing again (new code).

## 4. The two formats

### 4.1 A4 landscape, for print (`.cert.a4`)

297 × 210 mm. Nothing bleeds: the outermost ink is about 5.5 mm from the edge (the points of the corner stars) and all text is at least 12 mm in, so any office printer's margin is safe.

| Part | Geometry | Type |
|---|---|---|
| Frame | 9 mm from the edge: 0.7 mm black line, 1.9 mm yellow band, 0.25 mm black line | |
| Corner stars | 11 mm, two squares at 45°, black 0.37 mm stroke, yellow fill | |
| Arch with the school mark | 27 × 32 mm, top radius 13.5 mm, yellow, 0.5 mm black edge; mark 24 mm high (black PNG) | |
| School line | under the arch | Plex 600, 10.5 pt |
| Title «شهادة إتمام» | then a 30 × 1.7 mm yellow bar with a 0.3 mm black edge | Aref Ruqaa 700, 38 pt |
| «تُمنح هذه الشهادة إلى» | | Plex 400, 12.5 pt, `#4a4842` |
| Name box | 220 × 29 mm, fixed height, name centred in it | Amiri 700, 44 → 14 pt (§5) |
| Divider | 120 mm, 0.25 mm line, 2.6 mm diamond | |
| «لإتمام» | | Plex 400, 12.5 pt, `#4a4842` |
| Course | 225 mm wide | Plex 700, 19 / 16 / 13 pt (§5) |
| Kind and dates | 225 mm wide | Plex 400 (kind 600), 12.5 / 11 pt |
| Signatures | two blocks, 13 mm of blank space above a 0.3 mm line; name under the line, role under the name | name Plex 600, 11 / 9 pt; role 9 pt |
| Verify block | QR 25 × 25 mm including its 4-module quiet zone; code and link beside it | code Plex 700, 13.5 pt; link 8 pt; labels 8 pt |
| «صدرت في بغداد بتاريخ …» | last line | Plex 400, 9.5 pt, `#4a4842` |

Signature lines are blank: the school can sign and stamp a printed sheet by hand. The verify code is what proves an unsigned download. If the school later wants signature images, they sit in the 13 mm above each line.

### 4.2 Square share image (`.cert.sq`)

1080 × 1080 px PNG. Black canvas with the site's star pattern (`--pat`), yellow hairline frame, the same arch (138 × 162 px), title 92 px in yellow, name in white (92 → 36 px), course 44 / 36 / 30 px, kind and dates 28 / 24 px. A 132 px yellow band at the bottom holds the school name, the city and issue date, and the link `noor-alawsiya.com/c/{code}` in 28 px bold.

No QR on the square (a phone cannot scan its own screen), no signatures, no teacher. All text is at least 30 px from the edge. Board `sq-max80-at-360.png` shows the worst case at the size of a phone feed.

### 4.3 Colours

| Token | Value | Where |
|---|---|---|
| `--k` | `#0b0b0c` | paper: all strong text and lines. Screen: canvas |
| `--ink` | `#17171a` | paper: kind and dates |
| `--soft` | `#4a4842` | paper: small labels. Darker than the site's `--mute` (`#66635a`), which is too light for 8 pt on paper |
| `--y` | `#fffa00` | paper: fills with a black edge only. Screen: title, frame, band |
| white, `#e9e9e9`, `#d5d5d5` | | screen: name, dates, small labels |

## 5. Fit rules

### 5.1 The name (`mock/fit.js`)

Input: the name with runs of spaces collapsed. `measure(text, size)` is the advance width of the shaped text in Amiri Bold. Limit = box width × 0.98.

| Step | A4 (box 220 mm) | Square (box 940 px) |
|---|---|---|
| 1. one line, first size that fits | 44, 40, 36, 32, 28 pt | 92, 84, 76, 68, 60 px |
| 2. two lines, first size where both fit | 30, 27, 24, 21, 18, 16, 14 pt | 72, 64, 56, 50, 44, 40, 36 px |
| 3. computed size from the width (two lines, or one if the name has no space) | not below 10 pt | not below 24 px |
| 4. below that floor | do not issue; tell the admin | same |

The break for two lines is the space that makes the wider line as narrow as possible, and never right after «عبد، أبو، أبي، أبا، ابن، بن، بنت، آل، أم، ذو، ذي», so «عبد الكريم» and «آل ياسين» stay together. Line height 1.22. The box height holds two lines at the largest two-line size, so nothing below the name moves.

Measured results (`checks.json`):

| Name | Characters | A4 | Square |
|---|---|---|---|
| زينب حيدر كاظم | 14 | 1 line, 44 pt | 1 line, 92 px |
| 41 letters | 49 | 1 line, 32 pt | 2 lines, 72 px |
| 49 letters | 58 | 1 line, 28 pt | 2 lines, 72 px |
| database maximum | 80 | 2 lines, 30 pt | 2 lines, 56 px |
| wide letters with a shadda | 33 | 1 line, 40 pt | 1 line, 60 px |
| 80 characters of the widest letters (ض ص) | 79 | 2 lines, 21 pt | 2 lines, 32.1 px (step 3) |
| 39 letters, no space | 39 | 1 line, 40 pt | 1 line, 60 px |

So step 4 cannot be reached by a name with spaces inside the 80-character limit; it is there for garbage input only.

### 5.2 Course, dates, teacher

Each takes the first step whose text stays inside its line count. Lines are balanced (`text-wrap: balance`), never clipped.

| Field | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| Course | 19 pt / 44 px, 1 line | 16 pt / 36 px, 2 lines | 13 pt / 30 px, 3 lines |
| Kind and dates | 12.5 pt / 28 px, up to 2 lines | 11 pt / 24 px, 2 lines | |
| Teacher (A4) | 11 pt, up to 2 lines | 9 pt, 3 lines | |

Sample `fullest` puts every field at its database limit at once (course 119, teacher 114, start 60 characters): it fits both formats (boards `a4-fullest.png`, `sq-fullest.png`).

## 6. Verify code, link, QR, and the verify-page rule

**Code.** 8 characters from Crockford base 32 (`0-9 A-Z` without `I L O U`), 40 random bits from `crypto.randomBytes`, retried on a unique clash. Shown as `XXXX-XXXX`, always left to right. Codes starting `00` are never issued: they belong to samples and tests (the boards use `00EX-AMP1`).

**Link.** `https://noor-alawsiya.com/c/{code}`. `/c` alone is the form. Nothing under `/c` exists on any branch today.

**QR.** On A4 only. It encodes the link without the hyphen (`…/c/00EXAMP1`, 36 bytes), made by the repo's own `qrcode-generator` at level M as in `lib/qr.ts`: version 3, 29 × 29 modules, drawn as vector squares, black on white, 4-module quiet zone, 25 mm wide (0.68 mm per module).

**The rule for the page `/c/{code}`:**

1. **Read the code forgivingly.** Uppercase it, drop hyphens and spaces, read `O` as `0` and `I`, `L` as `1`. Anything that is not then 8 valid characters is treated exactly like an unknown code.
2. **Valid** (200): green «شهادة صحيحة.» and exactly what is printed on the certificate, from the snapshot: name, course, kind, dates, issue date, code. Nothing else: no phone, birth year, guardian, attendance, notes, or account link.
3. **Revoked** (200): red «شهادة ملغاة.» with the date, and the code. No name and no course.
4. **Unknown or malformed** (404): one message for both, «لا توجد شهادة بهذا الرقم.», with the form to try again. The page must not tell a mistyped code from a never-issued one.
5. **Too many tries** (429): at most 20 lookups per address in 10 minutes, then «محاولات كثيرة.». The lookup is a GET, so it does not go through `reserveAttempt` in `lib/auth.ts`; it needs its own small counter.
6. **Not for search engines.** `robots: noindex, nofollow` in the page metadata, not in `sitemap.ts`, `Cache-Control: no-store`. Do not add `/c` to the `disallow` list in `app/robots.ts`: as that file says about `/login`, a crawler has to fetch the page to see the noindex tag.
7. **No sign-in, no download.** The page only confirms. The PDF and the image are downloaded from the signed-in account («حسابي»), never from the verify page, so the code alone cannot fetch a copy.
8. **It says what the document is:** «هذه شهادة إتمام دورة وليست إجازة قرآنية.»
9. **Deleting a student deletes their certificates** (cascade); the code then answers as unknown.
10. **Audit by reference only**, as `lib/admin.ts` does today: `certificate.issued` and `certificate.revoked` with ids, never a name.

The verify page is the `.auth` screen the site already has (dark patterned page, one white card, logo, `.alert`, `.btn`), plus one fact list. New CSS: `mock/verify.css`, 12 rules. Boards `verify-*.png`.

Copy, Modern Standard Arabic:

| State | Text |
|---|---|
| Heading | التحقق من شهادة |
| Valid | **شهادة صحيحة.** صدرت عن المدرسة وهي سارية. |
| Labels | الاسم · الدورة · نوع الدورة · المدة · تاريخ الإصدار · رقم الشهادة |
| Note under a valid result | قارن الاسم والدورة بما هو مكتوب في الشهادة التي أمامك. هذه شهادة إتمام دورة وليست إجازة قرآنية. |
| Revoked | **شهادة ملغاة.** ألغتها المدرسة في {date} ولم تعد سارية. |
| Under revoked | لا تُعرض بيانات صاحب الشهادة بعد إلغائها. للاستفسار تواصل مع المدرسة. |
| Unknown | **لا توجد شهادة بهذا الرقم.** تأكد من الرقم كما هو مطبوع في الشهادة ثم حاول مرة أخرى. |
| Too many | **محاولات كثيرة.** انتظر دقيقة ثم حاول مرة أخرى. |
| Form | label «رقم الشهادة», hint «ثمانية أحرف وأرقام إنجليزية، مطبوعة أسفل الشهادة بجانب رمز QR.», button «تحقّق» |
| Second button | تحقق من شهادة أخرى |

## 7. Fonts, and how the PDF gets made

| File in `fonts/` | Used for | Version | Outlines | OS/2 `fsType` | Licence |
|---|---|---|---|---|---|
| `ArefRuqaa-Bold.ttf` | title | 1.003 | TrueType | 0 | SIL OFL 1.1 |
| `Amiri-Bold.ttf` | name | 1.002 | TrueType | 0 | SIL OFL 1.1 |
| `IBMPlexSansArabic-Regular.ttf` | body, labels | 1.101 | TrueType | 0 | SIL OFL 1.1 |
| `IBMPlexSansArabic-SemiBold.ttf` | school line, kind, signer names | 1.101 | TrueType | 0 | SIL OFL 1.1 |
| `IBMPlexSansArabic-Bold.ttf` | course, code | 1.101 | TrueType | 0 | SIL OFL 1.1 |

`fsType` 0 means installable embedding: the font may be embedded and subset in a document. The OFL allows it too. The files are the ones in `github.com/google/fonts` (`ofl/amiri`, `ofl/arefruqaa`, `ofl/ibmplexsansarabic`); `IBMPlexSansArabic-Bold.ttf` is byte-identical to `assets/fonts/` on `wave/awsiya-dev-course-share-2111-20261121`. `tools/font-facts.mjs` prints this table from the files.

**Proof that they embed** (`checks.json` → `pdf`): the three PDFs in `pdf/` were printed from the mock-up by Chromium. Each is one page, 841.92 × 594.96 pt, 56 to 66 KB, with five embedded subset TrueType fonts (`/FontFile2`): Amiri-Bold, ArefRuqaa-Bold and the three Plex weights. No Type 3 (bitmap) fonts. The code can be copied out as text.

**The site cannot use `next/font` for this.** `next/font` serves hashed WOFF2 subsets to browsers; a PDF writer needs the TTF files on disk. The build should keep them in `assets/fonts/` (one is already there on the course-share branch).

**Recommended build path: a server-made PDF with `pdfkit`.** Parents are on phones, where «print → save as PDF» is hidden or missing, so a print page is not enough; and a headless browser on Railway is too heavy for one page. `tools/pdf-probe.mjs` wrote the certificate's hardest lines with `pdfkit` 0.21.0 and `bidi-js` 1.1.0 (board `probe-pdfkit-text.png`, 24 KB PDF, four embedded subsets). What it found:

1. Joining, ligatures (the «الله» ligature, shadda) are right in all three fonts when a run is drawn with `features: ['rtla']`. Without it the words come out in left-to-right order.
2. `pdfkit` does no bidi: a line with a date or a code has to be cut into runs (`bidi-js`), first logical run at the right.
3. Arabic-Indic digits come out reversed («٢٠٢٦» as «٦٢٠٢»), even as their own run. Pass them already reversed.
4. Brackets are not mirrored («(ع)» becomes «)ع(»). Swap paired brackets inside right-to-left runs.
5. `widthOfString` gives the same widths as the browser (613.9 and 2031.4 at 100 pt for two test names), so the fit rule in §5 gives the same answer on the server.

The probe draws text lines only. Frame, arch, stars and QR are plain vector shapes and were not drawn by it.

**The share image is not settled.** `next/og` (Satori), which the course-share branch uses for link cards, cannot shape Aref Ruqaa and needs the presentation-forms workaround in `lib/og-arabic.ts` even for Plex; Amiri was not tried. Two candidates for the build lane to test: (a) draw the square with the same `fontkit` layout as glyph outlines into an SVG and rasterise it; (b) set the title and the name in Plex on the square only. This lane tested neither.

## 8. Where it appears on the site (for the build, not drawn here)

- **Admin:** on a course in «الدورات»: set «تاريخ الانتهاء», then «إصدار الشهادات» with a tick list of the accepted students. Issuing is always a person's decision; nothing issues by itself. If attendance tracking (`PROGRESS_TRACKING`, migration 0011 on `wave/awsiya-dev-progress-build-2208-20261122`) is on, show each student's attendance beside the tick as help.
- **Account:** a «شهاداتي» card with the course, the date, and two buttons: «تنزيل PDF» and «صورة للمشاركة».
- **Public:** only `/c` and `/c/{code}`.

## 9. Acceptance checks

`node docs/design/certificate/tools/shots.mjs` renders everything and writes `checks.json`. Last run 22/11/2026: all pass.

| Brief asks | Check | Result |
|---|---|---|
| Long names (40+ letters) still fit | 9 names × 2 formats (§5.1): every line inside the name box, at most 2 lines, lines fit the box height, no text closer than 12 mm (A4) / 30 px (square) to the edge, content ends above the frame, the name's ink does not touch the divider (pixel comparison with and without the name) | 18 / 18 |
| | Negative control: the same checks with the fit rule off (`?nofit=1`) on the 80-character name | caught: «name wider than its box» |
| | Every other field at its database limit (`fullest`) | fits, both formats |
| Contrast | WCAG ratio of every text colour on its background | A4: lowest 9.14 (`#4a4842` on white). Square: lowest 13.4 (`#d5d5d5` on black); black on yellow 17.73 |
| RTL | `dir=rtl` on the certificate; code and link isolated left-to-right; order **measured from glyph positions**: name right to left, year digits left to right, year left of its month, brackets of «(ع)» in order | all pass, 18 renders |
| Print preview in grey | the same contrast after a grey conversion (Rec. 601) | A4: lowest 9.15. Square: lowest 13.41; black on yellow 14.77 |
| | every yellow shape on A4 has a black edge (arch, bar, diamond, frame band, stars) | 5 / 5 |
| | the QR reads back from the colour board, the grey board and the fullest board | 3 / 3 → `https://noor-alawsiya.com/c/00EXAMP1` |
| PDF | one page, A4 landscape, three families embedded, no Type 3 | 3 / 3 |
| Verify page | no side scroll, every tap target ≥ 44 px, RTL, at 375 (five states), 768 and 1440 | 7 / 7 |

## 10. Boards

| Board | Shows |
|---|---|
| `board-a4.png` | all seven A4 samples and the grey preview on one sheet |
| `board-square.png` | all seven square samples and one in grey |
| `board-print-grey.png` | A4 in grey: normal name, 80 characters, every field at its limit |
| `a4-{base,long40,long58,max80,wide,sparse,fullest}.png` | A4, 1684 × 1191 |
| `sq-{same seven}.png` | square, 1080 × 1080 |
| `grey-a4-*.png`, `grey-sq-*.png` | grey previews (print media for A4) |
| `sq-max80-at-360.png` | the square at phone-feed size |
| `option-ruqaa-a4-{base,long58}.png` | the name in Aref Ruqaa instead of Amiri, for comparison. Not chosen: at 28 pt a long name is hard to read |
| `verify-{valid,revoked,unknown,form,busy}-375@2x.png`, `verify-valid-768.png`, `verify-valid-1440.png` | the verify page |
| `probe-pdfkit-text.png` | the server-PDF probe (§7), rasterised |

## 11. Running the tools

Nothing here is in `package.json`. The scripts take their helpers from the environment:

```
CERT_PW=<a node_modules folder with playwright>
CERT_CHROME=<chromium or chrome-headless-shell executable>
CERT_JSQR=<…/node_modules/jsqr/dist/jsQR.js>
node docs/design/certificate/tools/shots.mjs      # boards, pdf/, checks.json; exit 1 on any failure
node docs/design/certificate/tools/font-facts.mjs # the table in §7
node docs/design/certificate/tools/make-qr.mjs    # mock/qr.js, needs the repo's node_modules (qrcode-generator)
```

`pdftotext` on the PATH adds the text-extraction check; without it that one check is skipped.

## 12. Open, and not decided here

1. **The mark is 186 × 240 px.** At 24 mm high that is 254 dpi: acceptable, slightly soft next to vector type. A vector (SVG) or 1000 px mark from the school would fix it. Nothing else on the sheet is a bitmap.
2. **Who signs.** The mock-up shows the course's teacher(s) and «مدير المدرسة». The school decides whether there are one or two signers and whether sheets are signed by hand.
3. **What «completing» means.** Attendance threshold, an exam, or the teacher's word. The design assumes a person ticks each student.
4. **Privacy.** The verify page shows a student's name, often a minor's, to anyone who holds the code. That is the same information as on the sheet, but `/privacy` (pinned by `tests/privacy-truth.test.ts` on PR #5) and the guardian consent text do not mention it. The build must update both in the same change, or make issuing depend on the guardian's agreement.
5. **Hijri date.** Left out. A computed Hijri day can differ by a day from the sighting the school follows, so if it is wanted it should be typed by the admin, not calculated.
6. **Basmala or an ayah at the top.** Left out. There is about 20 mm of free height on A4 if the school wants one line; the text must come from the school.
7. **MediaBox.** Chromium's A4 is 841.92 × 594.96 pt, 0.11 mm short of ISO A4 in height. `pdfkit`'s `A4` is exact.
