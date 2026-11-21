/**
 * Access probes for every Server Action in app/**\/actions.ts, against a running `next start` and its Postgres.
 * Invented data only (scripts/e2e/setup.ts). Exits 1 on any FAIL. Used by the `actions-e2e` CI job.
 *
 *   DATABASE_URL=… node scripts/e2e/actions-probe.mjs http://127.0.0.1:3000 <tokens.json>
 *
 * A Server Action is a public endpoint: anyone can POST to it with any cookie. Each probe calls an action the way the
 * browser's runtime does and then checks the database, not only the answer.
 *
 * Three guards against a probe that passes for the wrong reason:
 * - Action ids change on every build. They are read from this build's .next/server/server-reference-manifest.json
 *   by file and export name. An unknown or stale id still answers 200, so a hard-coded id would make every
 *   "cannot do X" probe pass.
 * - Every probed action also has a positive control (a role that SHOULD get through, and does). An action with no
 *   passing control is a FAIL.
 * - Every action in the manifest must be listed below, as probed or as skipped with a reason. A new action with
 *   no entry is a FAIL, so a new endpoint cannot ship without a probe or a written reason.
 *
 * Body format (multipart, like encodeReply): fields prefixed `_1_`, then the root part `0` LAST. The server decodes
 * the stream in order; with `0` first the fields arrive empty and the action quietly validates nothing.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const [base, tokFile] = process.argv.slice(2);
if (!base || !tokFile || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=… node scripts/e2e/actions-probe.mjs <base url> <tokens.json>');
  process.exit(2);
}
const tok = JSON.parse(readFileSync(tokFile, 'utf8'));

// ------------------------------------------------------------------ action ids from this build

/** key → [file, export]. Every action in the manifest must appear here or in SKIPPED. */
const PROBED = {
  register: ['app/actions.ts', 'registerAction'],
  login: ['app/actions.ts', 'loginAction'],
  requestCourse: ['app/actions.ts', 'requestCourseAction'],
  adminLogin: ['app/admin/actions.ts', 'adminLoginAction'],
  review: ['app/admin/actions.ts', 'reviewAction'],
  notified: ['app/admin/actions.ts', 'notifiedAction'],
  studentReset: ['app/admin/actions.ts', 'studentResetAction'],
  addQuestion: ['app/admin/actions.ts', 'addQuestionAction'],
  toggleQuestion: ['app/admin/actions.ts', 'toggleQuestionAction'],
  moveQuestion: ['app/admin/actions.ts', 'moveQuestionAction'],
  invite: ['app/admin/admins/actions.ts', 'inviteAction'],
  resend: ['app/admin/admins/actions.ts', 'resendAction'],
  revoke: ['app/admin/admins/actions.ts', 'revokeAction'],
  disable: ['app/admin/admins/actions.ts', 'disableAction'],
  unlock: ['app/admin/admins/actions.ts', 'unlockAction'],
  setCourseOpen: ['app/admin/courses/actions.ts', 'setCourseOpenAction'],
  addCourse: ['app/admin/courses/actions.ts', 'addCourseAction'],
  acceptInvite: ['app/admin/invite/actions.ts', 'inviteAction'],
};
const SKIPPED = {
  'app/actions.ts#logoutAction': 'ends the caller’s own student session; no input, nothing to reach',
  'app/admin/actions.ts#adminLogoutAction': 'ends the caller’s own admin session; no input, nothing to reach',
};

const manifestPath = path.join(process.cwd(), '.next/server/server-reference-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byName = new Map();
for (const [id, entry] of Object.entries({ ...manifest.node, ...manifest.edge })) {
  if (entry.filename && entry.exportedName) byName.set(`${entry.filename}#${entry.exportedName}`, id);
}

const out = [];
let fails = 0;
const log = (label, ok, detail) => {
  if (!ok) fails++;
  out.push(`${ok ? 'PASS' : 'FAIL'} ${label} :: ${detail}`);
};

const known = new Set([...Object.values(PROBED).map(([f, e]) => `${f}#${e}`), ...Object.keys(SKIPPED)]);
for (const name of byName.keys()) {
  log(`manifest action ${name} has a probe or a written reason`, known.has(name), known.has(name) ? 'listed' : 'add it to PROBED (with a control) or SKIPPED in scripts/e2e/actions-probe.mjs');
}
const A = {};
for (const [key, [file, exp]] of Object.entries(PROBED)) {
  A[key] = byName.get(`${file}#${exp}`);
  if (!A[key]) log(`action ${file}#${exp} is in this build`, false, `not in ${manifestPath}: renamed or removed? Update PROBED.`);
}
if (fails) finish(); // cannot probe with missing ids

// ------------------------------------------------------------------ helpers

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const auditCount = async () => (await one('select count(*)::int as n from audit_log')).n;

/** Which probed actions had a positive control pass (proves the id is live and the call format is right). */
const live = new Set();
const control = (key, label, ok, detail) => {
  if (ok) live.add(key);
  log(`CONTROL ${label}`, ok, detail);
};

/**
 * Calls a Server Action. `root` is part 0: ['$undefined', '$K1'] for (prevState, formData) actions,
 * ['$K1'] for (formData) actions, or plain JSON arguments (notifiedAction(id)).
 */
async function act(page, key, fields, { cookie, root = ['$undefined', '$K1'], origin = base, headers = {} } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
  fd.append('0', JSON.stringify(root)); // root LAST: the server decodes the stream in order
  const h = { 'Next-Action': A[key], Accept: 'text/x-component', Origin: origin, ...headers };
  if (cookie) h.Cookie = cookie;
  const r = await fetch(base + page, { method: 'POST', body: fd, headers: h, redirect: 'manual' });
  const body = await r.text();
  const redirect = r.headers.get('x-action-redirect') ?? r.headers.get('location');
  // A redirected action threw redirect(): it returned nothing (row 0 then describes the target page, not an answer).
  return { status: r.status, redirect, setCookie: r.headers.get('set-cookie') ?? '', body, answer: redirect ? null : answerOf(body) };
}
const FORM = ['$K1'];
/**
 * Splits an RSC answer into rows: `<hex id>:<json>\n`, or `<hex id>:T<hex byte length>,<text>` with NO newline after
 * the text (long strings, such as a wa.me link, are sent like that).
 */
function rscRows(body) {
  const buf = Buffer.from(body, 'utf8');
  const rows = new Map();
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) break;
    const id = buf.subarray(i, colon).toString();
    if (buf[colon + 1] === 0x54 /* T */) {
      const comma = buf.indexOf(0x2c, colon);
      const len = parseInt(buf.subarray(colon + 2, comma).toString(), 16);
      rows.set(id, { text: buf.subarray(comma + 1, comma + 1 + len).toString() });
      i = comma + 1 + len;
    } else {
      const nl = buf.indexOf(0x0a, colon);
      const end = nl < 0 ? buf.length : nl;
      rows.set(id, { json: buf.subarray(colon + 1, end).toString() });
      i = end + 1;
    }
  }
  return rows;
}

/**
 * The action's own return value, or null. Row 0 points at it ("a":"$@<row>"); it can come after the whole re-rendered
 * page (refresh()), so the full body is read. A redirected call has none. "$<row>" strings point at text rows.
 */
function answerOf(body) {
  try {
    const rows = rscRows(body);
    const ref = JSON.parse(rows.get('0')?.json ?? 'null')?.a;
    if (typeof ref !== 'string' || !ref.startsWith('$@')) return null;
    const row = rows.get(ref.slice(2));
    if (!row?.json) return null;
    return JSON.parse(row.json, (_k, v) => {
      const m = typeof v === 'string' && /^\$([0-9a-f]+)$/.exec(v);
      return m && rows.get(m[1])?.text !== undefined ? rows.get(m[1]).text : v;
    });
  } catch {
    return null;
  }
}
const get = async (page, cookie) => {
  const r = await fetch(base + page, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location'), body: await r.text() };
};
/** The action got past its session check and answered with its own state (no redirect to a login or /admin). */
const answered = (r) => r.status === 200 && !r.redirect && ['ok', 'error', 'errors', 'saved'].some((k) => r.answer && k in r.answer);
/** One line for the log. A temporary password in an answer is never printed (invented data, but still). */
const short = (r) => `status ${r.status} redirect ${r.redirect}${r.answer === null ? '' : ` answer=${JSON.stringify(r.answer).replace(/"password":"[^"]*"/g, '"password":"<hidden>"').slice(0, 160)}`}`;

const S = `noor_a=${tok.super}`;
const ST = `noor_a=${tok.staff}`;
const SA = `noor_s=${tok.studentA}`;
const SB = `noor_s=${tok.studentB}`;
const { ids } = tok;
const closed = (await one(`select id from courses where not published and status = 'open' order by id limit 1`)).id;
const question = (await one('select id, position, active from form_questions where active order by position limit 1'));

// ------------------------------------------------------------------ 1. pages by role

for (const [page, cookie, label] of [
  ['/admin/admins', ST, 'staff'],
  ['/admin/courses', ST, 'staff'],
  ['/admin', SA, 'a student cookie'],
  ['/account', `noor_s=${tok.super}`, 'an admin token in the student cookie'],
]) {
  const r = await get(page, cookie);
  const leaked = /super@example\.test|staff@example\.test|علي حسن كاظم|زينب محمد جواد/.test(r.body);
  log(`GET ${page} as ${label} shows no private data`, !leaked, `status ${r.status} location ${r.location} leaked=${leaked}`);
}

// ------------------------------------------------------------------ 2. staff calls super-admin-only actions

let a0 = await auditCount();
let r = await act('/admin/courses', 'setCourseOpen', { id: String(closed), open: '1' }, { cookie: ST, root: FORM });
let pub = (await one('select published from courses where id = $1', [closed])).published;
log('staff cannot open a course', !pub && (await auditCount()) === a0, `${short(r)} published=${pub}`);

a0 = await auditCount();
r = await act('/admin/courses', 'addCourse', { name: 'دورة دخيلة', teacher: 'أستاذ دخيل', place: '', startedOn: '', open: 'on' }, { cookie: ST });
let n = (await one(`select count(*)::int as n from courses where name = 'دورة دخيلة'`)).n;
log('staff cannot add a course', n === 0 && (await auditCount()) === a0, `${short(r)} rows=${n}`);

a0 = await auditCount();
r = await act('/admin/admins', 'disable', { id: String(ids.sup), disabled: '1' }, { cookie: ST });
let dis = (await one('select disabled_at from admins where id = $1', [ids.sup])).disabled_at;
log('staff cannot disable the super admin', dis === null && (await auditCount()) === a0, short(r));

a0 = await auditCount();
r = await act('/admin/admins', 'invite', { email: 'evil@example.test', role: 'super_admin' }, { cookie: ST });
n = (await one(`select count(*)::int as n from admins where email = 'evil@example.test'`)).n;
log('staff cannot invite a super admin', n === 0 && r.answer === null && (await auditCount()) === a0, `${short(r)} rows=${n}`);

for (const key of ['resend', 'revoke']) {
  a0 = await auditCount();
  r = await act('/admin/admins', key, { id: String(ids.sup), reset: '1' }, { cookie: ST });
  const supRow = await one('select activated_at, password_hash from admins where id = $1', [ids.sup]);
  log(`staff cannot ${key} the super admin's invite`, supRow.activated_at !== null && supRow.password_hash !== null && r.answer === null && (await auditCount()) === a0, short(r));
}

// ------------------------------------------------------------------ 3. no session / student session on admin actions

for (const [cookie, label] of [[undefined, 'no cookie'], [SA, 'a student']]) {
  a0 = await auditCount();
  r = await act('/admin', 'review', { id: String(ids.regA), decision: 'accepted', from: 'pending', note: '' }, { cookie, root: FORM });
  const st = (await one('select status from registrations where id = $1', [ids.regA])).status;
  log(`${label} cannot accept a request`, st === 'pending', `${short(r)} now=${st}`);

  r = await act('/admin/form', 'addQuestion', { label: 'سؤال دخيل', kind: 'text', options: '', showIf: '' }, { cookie });
  n = (await one(`select count(*)::int as n from form_questions where label = 'سؤال دخيل'`)).n;
  log(`${label} cannot add a question`, n === 0, `${short(r)} rows=${n}`);

  r = await act('/admin/form', 'toggleQuestion', { id: String(question.id), active: '0' }, { cookie, root: FORM });
  const active = (await one('select active from form_questions where id = $1', [question.id])).active;
  log(`${label} cannot switch a question off`, active === true, `${short(r)} active=${active}`);

  r = await act('/admin/form', 'moveQuestion', { id: String(question.id), direction: 'down' }, { cookie, root: FORM });
  const pos = (await one('select position from form_questions where id = $1', [question.id])).position;
  log(`${label} cannot move a question`, pos === question.position, `${short(r)} position ${question.position}->${pos}`);

  log(`${label}: no audit row was written`, (await auditCount()) === a0, `audit ${a0}->${await auditCount()}`);
}

// The temporary password (staff and super may make one; nobody else).
const hashB = async () => (await one('select password_hash from students where id = $1', [ids.studentB])).password_hash;
const h0 = await hashB();
for (const [cookie, label] of [[undefined, 'no cookie'], [SB, 'student B (own request)']]) {
  r = await act('/admin', 'studentReset', { id: String(ids.regB) }, { cookie });
  log(`${label} cannot make a temporary password`, (await hashB()) === h0 && !r.answer?.password, short(r));
}

// ------------------------------------------------------------------ 4. cross-site origin with a valid super session (CSRF)

r = await act('/admin/courses', 'setCourseOpen', { id: String(closed), open: '1' }, { cookie: S, root: FORM, origin: 'https://evil.example' });
pub = (await one('select published from courses where id = $1', [closed])).published;
log('cross-origin call with a super session is refused (open a course)', !pub, `status ${r.status} published=${pub}`);
r = await act('/admin', 'studentReset', { id: String(ids.regB) }, { cookie: S, origin: 'https://evil.example' });
log('cross-origin call with a super session is refused (temporary password)', (await hashB()) === h0 && !r.answer?.password, `status ${r.status}`);

// ------------------------------------------------------------------ 5. students see and change only their own

const accA = await get('/account', SA);
log('student A /account does not show B', accA.status === 200 && !accA.body.includes('زينب محمد جواد'), `status ${accA.status}`);

const other = ids.openCourses[1];
const countFor = async (studentId) => (await one('select count(*)::int as n from registrations where student_id = $1', [studentId])).n;
const b0 = await countFor(ids.studentB);
const aBefore = await countFor(ids.studentA);
r = await act('/account', 'requestCourse', { courseId: String(other), note: 'x', guardianConsent: 'on', studentId: String(ids.studentB), student_id: String(ids.studentB) }, { cookie: SA });
const b1 = await countFor(ids.studentB);
const aAfter = await countFor(ids.studentA);
log('a posted studentId of B is ignored (the request lands on A)', b1 === b0 && aAfter === aBefore + 1, `${short(r)} B ${b0}->${b1} A ${aBefore}->${aAfter}`);
if (aAfter === aBefore + 1) live.add('requestCourse');

r = await act('/account', 'requestCourse', { courseId: String(closed), note: '' }, { cookie: SA });
n = (await one('select count(*)::int as n from registrations where course_id = $1', [closed])).n;
log('a course closed for registration cannot be requested by id', n === 0, `${short(r)} rows=${n}`);

r = await act('/account', 'requestCourse', { courseId: String(ids.openCourses[0]), note: '' });
log('no cookie cannot request a course', (await countFor(ids.studentA)) === aAfter && r.redirect?.startsWith('/login'), short(r));

// ------------------------------------------------------------------ 6. throttles

// Student sign-in: 5 wrong per phone, then refused, even from new addresses.
let seq = '';
for (let i = 0; i < 7; i++) {
  r = await act('/login', 'login', { phone: '07701230000', password: 'wrong-' + i }, { headers: { 'X-Real-IP': `10.9.0.${i + 1}` } });
  seq += r.answer?.error?.includes('محاولات كثيرة') ? 'T' : r.answer?.error?.includes('غير صحيحة') ? 'x' : '?';
}
log('student sign-in: 5 wrong, then refused even when X-Real-IP rotates', seq === 'xxxxxTT', seq);
if (seq.startsWith('x')) live.add('login');

// Admin sign-in: 5 wrong per e-mail and address, then refused.
const adminTry = async () => {
  const rr = await act('/admin/login', 'adminLogin', { email: 'staff@example.test', password: 'wrong', code: '' }, { headers: { 'X-Real-IP': '10.6.0.1' } });
  return rr.answer?.error?.includes('محاولات كثيرة') ? 'T' : rr.answer?.error?.includes('بيانات الدخول غير صحيحة') ? 'x' : '?';
};
seq = '';
for (let i = 0; i < 7; i++) seq += await adminTry();
log('admin sign-in: 5 wrong from one address, then refused', seq === 'xxxxxTT', seq);
if (seq.startsWith('x')) live.add('adminLogin');

// Staff cannot lift that lock (super-admin only); the super admin can (control further down).
a0 = await auditCount();
r = await act('/admin/admins', 'unlock', { id: String(ids.staff) }, { cookie: ST });
let after = await adminTry();
log('staff cannot unlock an admin', after === 'T' && (await auditCount()) === a0, `${short(r)} next sign-in: ${after}`);

// Registration: 8 per hour per address.
const regTry = async (ip) => {
  const rr = await act('/register', 'register', { fullName: 'ا', birthYear: '', phone: '', password: '', courseId: '' }, { headers: ip ? { 'X-Real-IP': ip } : {} });
  return rr.answer?.errors?.form?.includes('طلبات كثيرة') ? 'T' : rr.answer?.errors ? 'v' : '?';
};
seq = '';
for (let i = 0; i < 10; i++) seq += await regTry('10.8.0.1');
log('registration: 8 per hour per address, then refused', seq === 'vvvvvvvvTT', seq);
if (seq.startsWith('v')) live.add('register');
seq = '';
for (let i = 0; i < 10; i++) seq += await regTry(`10.7.0.${i + 1}`);
out.push(`INFO registration with a rotating X-Real-IP (safe only if the edge overwrites it) :: ${seq}`);
seq = '';
for (let i = 0; i < 10; i++) seq += await regTry(null);
out.push(`INFO registration with no X-Real-IP / X-Forwarded-For (all such clients share the "unknown" bucket) :: ${seq}`);

// ------------------------------------------------------------------ 7. invite links

a0 = await auditCount();
r = await act('/admin/invite/made-up-token', 'acceptInvite', { token: 'made-up-token-' + 'x'.repeat(30), name: 'دخيل', password: 'long-enough-pass-123', confirm: 'long-enough-pass-123' });
const deadInvite = r.answer?.step === 'dead' && r.answer.error.includes('هذه الدعوة غير صالحة');
log('a made-up invite token starts no session', deadInvite && !/noor_a=/.test(r.setCookie) && (await auditCount()) === a0, `${short(r)} invalid-invite answer=${deadInvite}`);
if (deadInvite) live.add('acceptInvite');

// ------------------------------------------------------------------ 8. positive controls (the ids are live and the format is right)

r = await act('/admin/courses', 'setCourseOpen', { id: String(closed), open: '1' }, { cookie: S, root: FORM });
pub = (await one('select published from courses where id = $1', [closed])).published;
control('setCourseOpen', 'super admin can open a course', pub === true, short(r));
await act('/admin/courses', 'setCourseOpen', { id: String(closed), open: '0' }, { cookie: S, root: FORM });

r = await act('/admin/courses', 'addCourse', { name: 'دورة الفحص الآلي', teacher: 'أستاذ تجريبي', place: '', startedOn: '', open: '' }, { cookie: S });
n = (await one(`select count(*)::int as n from courses where name = 'دورة الفحص الآلي'`)).n;
control('addCourse', 'super admin can add a course', n === 1 && r.answer?.saved === true, `${short(r)} rows=${n} answer=${JSON.stringify(r.answer)}`);

r = await act('/admin/form', 'addQuestion', { label: 'سؤال الفحص الآلي', kind: 'text', options: '', showIf: '' }, { cookie: ST });
n = (await one(`select count(*)::int as n from form_questions where label = 'سؤال الفحص الآلي'`)).n;
control('addQuestion', 'staff can add a question', n === 1, `${short(r)} rows=${n}`);

r = await act('/admin/form', 'toggleQuestion', { id: String(question.id), active: '0' }, { cookie: ST, root: FORM });
const off = (await one('select active from form_questions where id = $1', [question.id])).active;
control('toggleQuestion', 'staff can switch a question off', off === false, `${short(r)} active=${off}`);
await act('/admin/form', 'toggleQuestion', { id: String(question.id), active: '1' }, { cookie: ST, root: FORM });

a0 = await auditCount();
r = await act('/admin/form', 'moveQuestion', { id: String(question.id), direction: 'down' }, { cookie: ST, root: FORM });
const moved = await one(`select count(*)::int as n from audit_log where action = 'question.move' and target = $1`, [`question:${question.id}`]);
control('moveQuestion', 'staff can move a question', moved.n === 1, `${short(r)} audit ${a0}->${await auditCount()}`);

// notifiedAction(id) takes the request id as a plain argument. It only records decided requests, so decide one first.
r = await act('/admin', 'review', { id: String(ids.regA), decision: 'accepted', from: 'pending', note: '' }, { cookie: ST, root: FORM });
const stA = (await one('select status from registrations where id = $1', [ids.regA])).status;
control('review', 'staff can accept a request', stA === 'accepted', `${short(r)} now=${stA}`);
const notifiedRows = async () => (await one(`select count(*)::int as n from audit_log where action = 'registration.notified' and target = $1`, [`registration:${ids.regA}`])).n;
for (const [cookie, label] of [[undefined, 'no cookie'], [SA, 'a student']]) {
  r = await act('/admin', 'notified', {}, { cookie, root: [ids.regA] });
  log(`${label} cannot write a «notified» audit line`, (await notifiedRows()) === 0, short(r));
}
r = await act('/admin', 'notified', {}, { cookie: ST, root: [ids.regA] });
control('notified', 'staff can record «notified» for a decided request', (await notifiedRows()) === 1, short(r));

// Super-admin-only team actions. Mail is not configured here, so invite/resend stop at «mail not configured»
// after the role check; that answer (instead of a redirect to /admin) is the proof the call got through.
for (const [key, fields] of [['invite', { email: 'new@example.test', role: 'staff' }], ['resend', { id: String(ids.staff) }], ['revoke', { id: String(ids.staff) }]]) {
  r = await act('/admin/admins', key, fields, { cookie: S });
  control(key, `super admin gets past the role check (${key})`, answered(r), `${short(r)} answer=${JSON.stringify(r.answer)}`);
}

r = await act('/admin/admins', 'unlock', { id: String(ids.staff) }, { cookie: S });
after = await adminTry();
control('unlock', 'super admin can unlock an admin (next wrong sign-in is counted, not refused)', after === 'x', `${short(r)} next sign-in: ${after}`);

r = await act('/admin', 'studentReset', { id: String(ids.regB) }, { cookie: ST });
const changed = (await hashB()) !== h0;
control('studentReset', 'staff can make a temporary password', changed && /^[a-z2-9]{10}$/.test(r.answer?.password ?? '') && /^https:\/\/wa\.me\/9647801230009\?text=/.test(r.answer?.link ?? ''), `${short(r)} changed=${changed} to=${r.answer?.to} link=${String(r.answer?.link).slice(0, 34)}…`);

// Last: it ends the staff admin's sessions.
r = await act('/admin/admins', 'disable', { id: String(ids.staff), disabled: '1' }, { cookie: S });
dis = (await one('select disabled_at from admins where id = $1', [ids.staff])).disabled_at;
control('disable', 'super admin can disable a staff admin', dis !== null, short(r));

for (const key of Object.keys(PROBED)) {
  if (!live.has(key)) log(`action ${key} had a passing positive control`, false, 'no control passed: the id or the call format may be wrong, so its negative probes prove nothing');
}

await db.end();
finish();

function finish() {
  const pass = out.filter((l) => l.startsWith('PASS')).length;
  const summary = `${pass} passed, ${fails} failed`;
  console.log(out.join('\n'));
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Server Action probes: ${summary}\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
  }
  process.exit(fails ? 1 : 0);
}
