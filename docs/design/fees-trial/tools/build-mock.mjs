// Builds the mock-up pages behind the boards in ../boards.
//
//   node build-mock.mjs <site-dir>
//
// <site-dir> must hold a real prerendered course page and its assets, copied from a `next build` of a branch that has
// the course page (92c3bfb or later):
//   <site-dir>/narjis-2026.html                  from .next/server/app/courses/narjis-2026.html
//   <site-dir>/_next/static/{chunks/*.css,media} from .next/static
//   <site-dir>/img/mark-black.png, mark-yellow.png from public/img
// The script strips the scripts, swaps in the scenario's facts and adds the proposed blocks. Nothing here talks to a
// database or to the live site. Filled states use invented numbers and say so in the caption above each page.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = process.argv[2];
if (!site) throw new Error('usage: node build-mock.mjs <site-dir>');

const WHATSAPP = 'https://wa.me/9647729841000'; // lib/data.ts CONTACT.whatsapp
const REAL = 'دورة السيدة نرجس (ع)';

const IC = {
  cash: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 10.500v3M17.500 10.500v3"/>',
  trial: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M9 15.200l2.200 2.200 4-4.400"/>',
  bell: '<path d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2.5h-15z"/><path d="M10 21h4"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
};
const icon = (name, size = '') => `<svg class="i${size ? ' ' + size : ''}" viewBox="0 0 24 24" aria-hidden="true">${IC[name]}</svg>`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const wa = (text) => `${WHATSAPP}?text=${encodeURIComponent(text)}`;
const NA = '<span class="na">غير مذكور</span>';
const money = (n) => new Intl.NumberFormat('ar-EG').format(n);
const PERIOD = { course: 'للدورة كاملة', month: 'شهرياً' };

// The ready WhatsApp messages. The visitor sends them; the site sends nothing.
export const MESSAGES = {
  fee: (course) => `السلام عليكم، أودّ السؤال عن رسوم «${course}».`,
  trial: (course) => `السلام عليكم، هل تتوفر حصة تجريبية في «${course}»؟`,
  both: (course) => `السلام عليكم، أودّ السؤال عن رسوم «${course}»، وهل تتوفر فيها حصة تجريبية؟`,
  book: (course) => `السلام عليكم، أرغب في حجز حصة تجريبية في «${course}».`,
};

const rows = (list) => {
  const kept = list.filter(([, value]) => value);
  return kept.length ? `<dl class="fx-d">${kept.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>` : '';
};
const updated = (date) => (date ? `<p class="fx-u">آخر تحديث: ${date}</p>` : '');
const askBtn = (label, text) => `<a class="btn o" href="${esc(wa(text))}" target="_blank" rel="noopener noreferrer">${icon('msg', 's')}${label}</a>`;

/** «الرسوم». fee.kind: null (غير مذكور) | 'free' | 'paid'. A paid course may still have no amount. */
export function feeBlock(course, fee, id = 'fee-h') {
  const head = `<header class="fx-h"><span class="fx-ic">${icon('cash')}</span><h2 id="${id}">الرسوم</h2></header>`;
  let body;
  if (!fee.kind) {
    body = `<div class="fx-b"><p class="fx-v na"><b>غير مذكور</b><span>لم تذكر المدرسة رسوم هذه الدورة بعد.</span></p><div class="fx-a">${askBtn('اسأل المدرسة عن الرسوم', MESSAGES.fee(course))}</div></div>`;
  } else if (fee.kind === 'free') {
    body = `<div class="fx-b"><p class="fx-v on"><b>مجانية</b><span>لا رسوم على هذه الدورة.</span></p>${rows([['ملاحظة', fee.note]])}</div>${updated(fee.updated)}`;
  } else if (fee.amount) {
    body = `<div class="fx-b"><p class="fx-v on"><b>${money(fee.amount)}<small>دينار عراقي</small></b><span>${PERIOD[fee.period]}</span></p>${rows([['طريقة الدفع', fee.pay], ['ملاحظة', fee.note]])}</div>${updated(fee.updated)}`;
  } else {
    body = `<div class="fx-b"><p class="fx-v na"><b>برسوم</b><span>المبلغ غير مذكور.</span></p>${rows([['طريقة الدفع', fee.pay], ['ملاحظة', fee.note]])}</div><div class="fx-a">${askBtn('اسأل المدرسة عن الرسوم', MESSAGES.fee(course))}</div>${updated(fee.updated)}`;
  }
  return `<section class="card fx fx-fee" aria-labelledby="${id}">${head}${body}</section>`;
}

/** «حصة تجريبية». trial.kind: null (غير مذكور) | 'offered' | 'none'. Shown only while the course takes registrations. */
export function trialBlock(course, trial, id = 'trial-h') {
  const tag = trial.kind === 'offered' ? '<span class="tag ok"><i></i>متاحة</span>' : trial.kind === 'none' ? '<span class="tag">غير متاحة</span>' : '';
  const head = `<header class="fx-h"><span class="fx-ic">${icon('trial')}</span><h2 id="${id}">حصة تجريبية</h2>${tag}</header>`;
  let body;
  if (!trial.kind) {
    body = `<div class="fx-b"><p class="fx-v na"><b>غير مذكور</b><span>لم تذكر المدرسة بعد هل تتوفر حصة تجريبية في هذه الدورة.</span></p><div class="fx-a">${askBtn('اسأل المدرسة عن الحصة التجريبية', MESSAGES.trial(course))}</div></div>`;
  } else if (trial.kind === 'none') {
    body = `<p>لا تتوفر حصة تجريبية في هذه الدورة.</p>${rows([['ملاحظة', trial.note]])}`;
  } else {
    body = `<p>تتيح المدرسة حصة تجريبية في هذه الدورة.</p><div class="fx-b">${rows([['الموعد', trial.when ?? NA], ['ملاحظة', trial.note]])}<div class="fx-a"><a class="btn k" href="${esc(wa(MESSAGES.book(course)))}" target="_blank" rel="noopener noreferrer">${icon('msg', 's')}احجز حصة تجريبية على واتساب</a></div></div><p class="fx-hint">يفتح الزر واتساب برسالة جاهزة إلى المدرسة، وأنت ترسلها. لا يحفظ الموقع رقمك.</p>`;
  }
  return `<section class="card fx fx-trial" aria-labelledby="${id}">${head}${body}</section>`;
}

/** Both facts missing while registration is open: one card, two rows, one question. */
export function bothUnknownBlock(course, id = 'info-h') {
  return `<section class="card fx fx-both" aria-labelledby="${id}"><header class="fx-h"><span class="fx-ic">${icon('cash')}</span><h2 id="${id}">الرسوم والحصة التجريبية</h2></header><div class="fx-b"><dl class="fx-d"><div><dt>${icon('cash', 's')}الرسوم</dt><dd>${NA}</dd></div><div><dt>${icon('trial', 's')}حصة تجريبية</dt><dd>${NA}</dd></div></dl><div class="fx-a">${askBtn('اسأل المدرسة عنهما على واتساب', MESSAGES.both(course))}</div></div><p class="fx-hint">«غير مذكور» تعني أن المدرسة لم تذكر المعلومة بعد. يفتح الزر واتساب برسالة جاهزة، وأنت ترسلها.</p></section>`;
}

// The waitlist form of PR #3 (components/WaitlistForm.tsx at ce2ab94), with its own strings, unchanged.
const pr3Form = (p) => `<form class="wl-form" novalidate onsubmit="return false">
<div class="field"><label for="${p}-phone">رقم واتساب ولي الأمر<em class="req" aria-hidden="true"> *</em></label><input id="${p}-phone" name="phone" class="inp ltr" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" aria-required="true" aria-describedby="${p}-phone-hint"><span class="hint" id="${p}-phone-hint">رقم عراقي، مثل 07701234567.</span></div>
<div class="field"><label for="${p}-guardianName">اسم ولي الأمر (اختياري)</label><input id="${p}-guardianName" name="guardianName" class="inp" autocomplete="name" maxlength="80"></div>
<div class="field"><label for="${p}-ageBand">عمر الطالب (اختياري)</label><select id="${p}-ageBand" name="ageBand" class="inp"><option value="">ما أريد أحدد</option><option>أقل من ١٠ سنوات</option><option>من ١٠ إلى ١٤ سنة</option><option>١٥ سنة فأكثر</option></select></div>
<div class="field"><label class="opt"><input type="checkbox" id="${p}-consent" name="consent"><span>أوافق أن تحتفظ المدرسة بهذا الرقم حتى تبلّغني لما تنفتح دورة، حسب <a href="/privacy#waitlist">سياسة الخصوصية</a>.</span></label></div>
<button class="btn k" type="submit">بلّغوني لما تنفتح</button></form>`;

/** Registration closed (and the course not finished): this takes the place of «حصة تجريبية». */
export function waitBlock(course, { open = false, id = 'wait-h', prefix = 'wl' } = {}) {
  return `<section class="card fx fx-wait" aria-labelledby="${id}"><header class="fx-h"><span class="fx-ic">${icon('bell')}</span><h2 id="${id}">التسجيل مغلق الآن</h2></header><p>لا تستقبل هذه الدورة طلبات تسجيل ولا حجز حصة تجريبية الآن. اترك رقم واتساب ولي الأمر، وتراسلك المدرسة عند فتح التسجيل.</p><details${open ? ' open' : ''}><summary class="btn k">${icon('bell', 's')}أبلِغوني عند فتح التسجيل</summary>${pr3Form(prefix)}</details></section>`;
}

/** The blocks a course page shows, by state. This is the rule table of SPEC.md §3. */
export function blocksFor(c) {
  if (c.status !== 'open' || c.dbDown) return ''; // finished or unknown courses, and pages rendered without the database
  if (!c.accepting) return feeBlock(c.name, c.fee) + waitBlock(c.name, { open: c.waitOpen });
  if (!c.fee.kind && !c.trial.kind) return bothUnknownBlock(c.name);
  return feeBlock(c.name, c.fee) + trialBlock(c.name, c.trial);
}

/** Facts already known go beside the course name, so a parent sees them before scrolling. Missing facts add nothing. */
export function headTags(c) {
  const tags = [];
  if (c.fee.kind === 'free') tags.push('<span class="tag">مجانية</span>');
  else if (c.fee.kind === 'paid' && c.fee.amount) tags.push(`<span class="tag">${money(c.fee.amount)} دينار ${PERIOD[c.fee.period]}</span>`);
  if (c.accepting && c.trial.kind === 'offered') tags.push('<span class="tag">حصة تجريبية متاحة</span>');
  return tags.join('');
}

// ---------- pages ----------

const DEMO = { name: 'دورة مثال للعرض', kindLabel: 'أحكام التلاوة والتجويد', teacher: 'اسم الأستاذ (مثال)', place: 'اسم الجامع، المنطقة (مثال)', start: '١ كانون الثاني ٢٠٢٧' };
const DEMO_NOTE = 'دورة وأرقام مخترعة للعرض فقط، ليست معلومات المدرسة';

const SCENARIOS = [
  {
    key: '01-unknown',
    caption: 'الحالة التي تُنشر أولاً: لا جواب من المدرسة بعد · حالة «التسجيل مفتوح» هنا للعرض فقط',
    course: { name: REAL, real: true, status: 'open', accepting: true, fee: { kind: null }, trial: { kind: null } },
  },
  {
    key: '02-filled',
    caption: `رسوم مذكورة + حصة تجريبية متاحة · ${DEMO_NOTE}`,
    course: {
      ...DEMO, status: 'open', accepting: true,
      fee: { kind: 'paid', amount: 25000, period: 'month', pay: 'نقداً في مقر الدورة', note: 'تُدفع في أول كل شهر.', updated: '٢٢ تشرين الثاني ٢٠٢٦' },
      trial: { kind: 'offered', when: 'السبت، الساعة ٤:٠٠ عصراً', note: 'يحضر ولي الأمر مع الطالب.' },
    },
  },
  {
    key: '03-free-no-trial',
    caption: `دورة مجانية + لا حصة تجريبية · ${DEMO_NOTE}`,
    course: { ...DEMO, status: 'open', accepting: true, fee: { kind: 'free', updated: '٢٢ تشرين الثاني ٢٠٢٦' }, trial: { kind: 'none' } },
  },
  {
    key: '04-waitlist',
    caption: `التسجيل مغلق: قائمة الانتظار (PR #3) مكان الحصة التجريبية، والرسوم غير مذكورة · ${DEMO_NOTE}`,
    course: { ...DEMO, status: 'open', accepting: false, fee: { kind: null }, trial: { kind: 'offered' } },
  },
  {
    key: '05-waitlist-open',
    caption: `التسجيل مغلق، والنموذج مفتوح (نموذج PR #3 بنصوصه كما هي) · ${DEMO_NOTE}`,
    course: { ...DEMO, status: 'open', accepting: false, waitOpen: true, fee: { kind: 'paid', amount: 25000, period: 'month', updated: '٢٢ تشرين الثاني ٢٠٢٦' }, trial: { kind: null } },
  },
  {
    key: '06-mixed',
    caption: `برسوم بلا مبلغ + حصة تجريبية متاحة بلا موعد · ${DEMO_NOTE}`,
    course: { ...DEMO, status: 'open', accepting: true, fee: { kind: 'paid', pay: 'نقداً في مقر الدورة' }, trial: { kind: 'offered' } },
  },
];

const base = readFileSync(join(site, 'narjis-2026.html'), 'utf8');
const EXTRA_CSS = '<link rel="stylesheet" href="/fees-trial.css"><link rel="stylesheet" href="/pr3-waitlist.css"><link rel="stylesheet" href="/board.css">';

function shell(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<link rel="preload" as="script"[^>]*>/g, '')
    .replace(/ srcSet="[^"]*"/g, '')
    .replace(/ loading="lazy"/g, '')
    .replace(/src="\/_next\/image\?url=%2Fimg%2F(mark-[a-z]+\.png)[^"]*"/g, 'src="/img/$1"')
    .replace('</head>', `${EXTRA_CSS}</head>`);
}
const cap = (text) => `<div class="board-cap" aria-hidden="true">${text}</div>`;

function page({ caption, course: c }) {
  let html = shell(base);
  if (!c.real) {
    html = html
      .replaceAll(REAL, c.name)
      .replace('<dd>أحكام التلاوة والتجويد</dd>', `<dd>${c.kindLabel}</dd>`)
      .replace('<dd>الأستاذ علاء</dd>', `<dd>${c.teacher}</dd>`)
      .replace('<dd>جامع الإمام علي (ع)، البلديات</dd>', `<dd>${c.place}</dd>`)
      .replace('<dd>٣ أيار ٢٠٢٦</dd>', `<dd>${c.start}</dd>`);
  }
  const openTag = c.accepting ? '<span class="tag ok"><i></i>التسجيل مفتوح</span>' : '';
  html = html.replace('<span class="tag ok"><i></i>قائمة</span>', `${openTag}<span class="tag ok"><i></i>قائمة</span>${headTags(c)}`);
  if (c.accepting) {
    html = html.replace('<div class="acts"><a class="btn k" href="https://wa.me/9647729841000"', '<div class="acts"><a class="btn y" href="/register?course=1">سجّل في هذه الدورة</a><a class="btn o" href="https://wa.me/9647729841000"');
  }
  html = html.replace('<section class="card cshare"', `${blocksFor(c)}<section class="card cshare"`);
  return html.replace(/<body>/, `<body>${cap(caption)}`);
}

for (const s of SCENARIOS) writeFileSync(join(site, `${s.key}.html`), page(s));

// ---------- the states sheet: every state of each block, at phone card width ----------

const head = shell(base).match(/^[\s\S]*?<\/head>/)[0].replace(/<title>[^<]*<\/title>/, '<title>لوحة الحالات</title>');
const cell = (label, block) => `<figure class="st"><figcaption>${label}</figcaption>${block}</figure>`;
const N = DEMO.name;
const F = { kind: 'paid', amount: 25000, period: 'month', pay: 'نقداً في مقر الدورة', note: 'تُدفع في أول كل شهر.', updated: '٢٢ تشرين الثاني ٢٠٢٦' };
const sheet = `${head}<body class="sheet">${cap(`كل حالات البطاقتين بعرض الهاتف (٣٣٩ بكسل داخل صفحة ٣٧٥) · ${DEMO_NOTE}`)}<main id="main">
<h1 class="vh">لوحة الحالات</h1>
<section aria-label="الرسوم"><h2 class="st-h">الرسوم</h2><div class="st-row">
${cell('١ · مذكورة (مبلغ + مدة + دفع + ملاحظة)', feeBlock(N, F, 's-fee-1'))}
${cell('٢ · مذكورة (مبلغ للدورة كاملة فقط)', feeBlock(N, { kind: 'paid', amount: 150000, period: 'course', updated: F.updated }, 's-fee-2'))}
${cell('٣ · مجانية', feeBlock(N, { kind: 'free', updated: F.updated }, 's-fee-3'))}
${cell('٤ · برسوم، والمبلغ غير مذكور', feeBlock(N, { kind: 'paid', pay: F.pay }, 's-fee-4'))}
${cell('٥ · غير مذكور', feeBlock(N, { kind: null }, 's-fee-5'))}
</div></section>
<section aria-label="حصة تجريبية"><h2 class="st-h">حصة تجريبية</h2><div class="st-row">
${cell('١ · متاحة (موعد + ملاحظة)', trialBlock(N, { kind: 'offered', when: 'السبت، الساعة ٤:٠٠ عصراً', note: 'يحضر ولي الأمر مع الطالب.' }, 's-trial-1'))}
${cell('٢ · متاحة، والموعد غير مذكور', trialBlock(N, { kind: 'offered' }, 's-trial-2'))}
${cell('٣ · غير متاحة', trialBlock(N, { kind: 'none' }, 's-trial-3'))}
${cell('٤ · غير مذكور', trialBlock(N, { kind: null }, 's-trial-4'))}
</div></section>
<section aria-label="حالات مشتركة"><h2 class="st-h">حالات مشتركة</h2><div class="st-row">
${cell('الاثنتان غير مذكورتين (بطاقة واحدة)', bothUnknownBlock(N, 's-both'))}
${cell('التسجيل مغلق: قائمة الانتظار', waitBlock(N, { id: 's-wait-1', prefix: 'wl1' }))}
${cell('قائمة الانتظار، النموذج مفتوح (PR #3)', waitBlock(N, { open: true, id: 's-wait-2', prefix: 'wl2' }))}
</div></section>
</main></body></html>`;
writeFileSync(join(site, 'states.html'), sheet);

// ---------- admin: the same facts as fields in «الدورات» ----------

const radio = (name, value, label, checked) => `<label class="opt"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}>${label}</label>`;
const field = (id, label, hint, control) => `<div class="field"><label for="${id}">${label}</label>${control}${hint ? `<span class="hint" id="${id}-hint">${hint}</span>` : ''}</div>`;
const input = (id, value, attrs = '') => `<input id="${id}" name="${id}" class="inp" value="${esc(value)}" aria-describedby="${id}-hint" ${attrs}>`;

function adminForm(p, filled) {
  const fee = filled
    ? `<div class="sub"><div class="two">${field(`${p}feeAmount`, 'المبلغ بالدينار العراقي', 'أرقام فقط، مثل 25000. اتركه فارغاً إن لم يُعلن المبلغ.', input(`${p}feeAmount`, '25000', 'inputmode="numeric" maxlength="8" dir="ltr" style="text-align:right"'))}${field(`${p}feePeriod`, 'المبلغ عن', 'يلزم عند كتابة مبلغ.', `<select id="${p}feePeriod" name="${p}feePeriod" class="inp" aria-describedby="${p}feePeriod-hint"><option>شهرياً</option><option>للدورة كاملة</option></select>`)}</div>${field(`${p}feePay`, 'طريقة الدفع (اختياري)', 'حتى ١٢٠ حرفاً.', input(`${p}feePay`, 'نقداً في مقر الدورة', 'maxlength="120"'))}${field(`${p}feeNote`, 'ملاحظة عن الرسوم (اختياري)', 'حتى ٢٠٠ حرف، مثل ما تشمله الرسوم.', input(`${p}feeNote`, 'تُدفع في أول كل شهر.', 'maxlength="200"'))}</div>`
    : '';
  const trial = filled
    ? `<div class="sub">${field(`${p}trialWhen`, 'موعد الحصة التجريبية (اختياري)', 'كما تكتبه المدرسة، حتى ٨٠ حرفاً.', input(`${p}trialWhen`, 'السبت، الساعة ٤:٠٠ عصراً', 'maxlength="80"'))}${field(`${p}trialNote`, 'ملاحظة عن الحصة (اختياري)', 'حتى ٢٠٠ حرف.', input(`${p}trialNote`, 'يحضر ولي الأمر مع الطالب.', 'maxlength="200"'))}</div>`
    : '';
  return `<form class="card q" novalidate onsubmit="return false"><h2 class="qh">الرسوم والحصة التجريبية</h2><p class="mute" style="font-size:14px;margin-bottom:14px">${DEMO.name}. ما تتركه «غير مذكور» يظهر للزائر «غير مذكور».</p>
<fieldset class="fx-set"><legend>الرسوم</legend><div class="opts">${radio(`${p}fee`, '', 'غير مذكور', !filled)}${radio(`${p}fee`, 'free', 'مجانية', false)}${radio(`${p}fee`, 'paid', 'برسوم', filled)}</div>${fee}</fieldset>
<fieldset class="fx-set"><legend>الحصة التجريبية</legend><div class="opts">${radio(`${p}trial`, '', 'غير مذكور', !filled)}${radio(`${p}trial`, 'offered', 'متاحة', filled)}${radio(`${p}trial`, 'none', 'غير متاحة', false)}</div>${trial}</fieldset>
<button class="btn k" type="submit">حفظ</button></form>`;
}

const adminRow = (n, name, state, tags) => `<li class="qrow"><span class="qn">${n}</span><div><b>${name}</b><div class="qmeta">${state}<span class="mute">${DEMO.teacher}</span>${tags}</div></div><div class="sp"><a class="btn sm w" href="#" aria-label="تعديل رسوم ${name} وحصتها التجريبية">الرسوم والحصة</a><button class="btn sm no" aria-label="إغلاق التسجيل في ${name}">إغلاق التسجيل</button></div></li>`;
const admin = `${head.replace('لوحة الحالات', 'حقول الإدارة')}<body class="sheet adm">${cap(`الإدارة «الدورات»: الحقول الجديدة، وما ينقص كل دورة · ${DEMO_NOTE}`)}<main id="main">
<h1 class="vh">حقول الإدارة</h1>
<section aria-label="قائمة الدورات"><h2 class="st-h">في قائمة الدورات: ما ينقص كل دورة، وزر التعديل</h2>
<div class="card"><ol class="qlist">
${adminRow('١', 'دورة مثال للعرض (أ)', '<span class="tag ok">تقبل التسجيل</span>', '<span class="tag warn">الرسوم: غير مذكور</span><span class="tag warn">الحصة التجريبية: غير مذكور</span>')}
${adminRow('٢', 'دورة مثال للعرض (ب)', '<span class="tag ok">تقبل التسجيل</span>', '<span class="mute">٢٥٬٠٠٠ دينار شهرياً</span><span class="mute">حصة تجريبية متاحة</span>')}
</ol></div></section>
<section aria-label="نموذج التعديل"><h2 class="st-h">نموذج التعديل</h2><div class="st-row adm-row">
${cell('بعد جواب المدرسة', adminForm('a', true))}
${cell('أول مرة: كل شيء «غير مذكور»', adminForm('b', false))}
</div></section>
</main></body></html>`;
writeFileSync(join(site, 'admin.html'), admin);

copyFileSync(join(here, '..', 'fees-trial.css'), join(site, 'fees-trial.css'));
copyFileSync(join(here, 'board.css'), join(site, 'board.css'));
copyFileSync(join(here, 'pr3-waitlist.css'), join(site, 'pr3-waitlist.css'));
console.log(`wrote ${SCENARIOS.length} scenario pages, states.html and admin.html to ${site}`);
export { SCENARIOS };
