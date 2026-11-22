// The registration form on a phone: what a parent may type for a phone number or a year, which field takes focus
// after a failed check, and the course a link preselects. Invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { loginStudent } from '@/lib/accounts';
import { resetDbForTests, type Db } from '@/lib/db';
import { errorTarget, isYearShape, latinDigits, normalizePhone, phoneError, pickCourse, STUDENT_FIELDS, toYear, type OpenCourse } from '@/lib/form-rules';
import { register, validateStudent, type RegistrationInput } from '@/lib/registration';

const YEAR = new Date().getFullYear();
const student = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
  fullName: 'طالب تجريبي', birthYear: String(YEAR - 25), phone: '07701234567', password: 'password-1',
  guardianName: '', guardianPhone: '', guardianConsent: false, courseId: '1', answers: {},
  ...over,
});

test('a phone number is accepted however a parent types or pastes it, and always becomes 07XXXXXXXXX', () => {
  const same = [
    '07701234567',
    '٠٧٧٠١٢٣٤٥٦٧', // Arabic-Indic digits
    '۰۷۷۰۱۲۳۴۵۶۷', // Persian / Kurdish keyboard digits
    '٠٧٧٠ ۱۲۳ 4567', // a mix
    '0770 123 4567',
    '0770-123-4567',
    '+9647701234567',
    '+964 770 123 4567',
    '+964 0770 123 4567', // the 0 kept after the country code
    '00964 (0) 770 - 123 - 4567',
    '009647701234567',
    '9647701234567',
    '7701234567', // as written after +964
    '+٩٦٤ ٧٧٠ ١٢٣ ٤٥٦٧',
    '‪+964 770 123 4567‬', // direction marks, as copied from a contact card
    '‎0770 123 4567', // left-to-right mark and no-break spaces
    '  07701234567  ',
  ];
  for (const typed of same) assert.equal(normalizePhone(typed), '07701234567', JSON.stringify(typed));
  for (const prefix of ['073', '074', '075', '076', '077', '078', '079']) assert.equal(normalizePhone(`${prefix}01234567`), `${prefix}01234567`);
});

test('what is not an Iraqi mobile number is refused', () => {
  for (const typed of ['', '   ', 'abc', '0770123456', '077012345678', '07101234567', '07201234567', '017701234', '+1 770 123 4567', '+44 7701 234567', '0770+1234567', '964', '077', '77012345678', '+0964 7701234567']) {
    assert.equal(normalizePhone(typed), null, JSON.stringify(typed));
  }
});

test('a refused phone number gets a message that says what to fix', () => {
  assert.equal(phoneError('07701234567'), null);
  assert.equal(phoneError('۰۷۷۰۱۲۳۴۵۶۷', 'guardian'), null);
  assert.equal(phoneError(''), 'اكتب رقم الهاتف.');
  assert.equal(phoneError(' - '), 'اكتب رقم الهاتف.');
  assert.equal(phoneError('', 'guardian'), 'اكتب رقم هاتف ولي الأمر.');
  assert.equal(phoneError('0770123456'), 'الرقم ناقص. رقم الهاتف ١١ رقماً، مثل 07701234567.');
  assert.equal(phoneError('٠٧٧٠١٢٣'), 'الرقم ناقص. رقم الهاتف ١١ رقماً، مثل 07701234567.');
  assert.equal(phoneError('+964 770 123 456', 'guardian'), 'اكتب رقم هاتف عراقياً يبدأ بـ 07، مثل 07701234567.'); // nine digits after the code: not clearly a short 07 number
  assert.equal(phoneError('077012345678'), 'الرقم أطول من اللازم. رقم الهاتف ١١ رقماً، مثل 07701234567.');
  assert.equal(phoneError('017701234'), 'اكتب رقم هاتف عراقياً يبدأ بـ 07، مثل 07701234567.');
  assert.equal(phoneError('abc'), 'اكتب رقم الهاتف.');
  // The server and the form use the same words.
  assert.equal(validateStudent(student({ phone: '0770123456' })).errors.phone, phoneError('0770123456'));
  const minor = validateStudent(student({ birthYear: String(YEAR - 12), guardianName: 'ولي أمر تجريبي', guardianPhone: '0770', guardianConsent: true }));
  assert.equal(minor.errors.guardianPhone, phoneError('0770', 'guardian'));
});

test('the birth year reads Arabic-Indic and Persian digits; anything but four digits is refused as a shape', () => {
  assert.equal(latinDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ 0123456789'), '0123456789 0123456789 0123456789');
  assert.equal(toYear(' ٢٠١٠ '), 2010);
  assert.equal(toYear('۲۰۱۰'), 2010);
  for (const ok of ['2010', '٢٠١٠', '۲۰۱۰', ' 2010 ']) assert.ok(isYearShape(ok), ok);
  for (const bad of ['', '10', '20100', '2o10', '1e3', '-201', '2010.']) assert.ok(!isYearShape(bad), bad);
  const at = new Date(`${YEAR}-06-01T00:00:00Z`);
  const persian = validateStudent(student({ birthYear: latinToPersian(String(YEAR - 12)), guardianName: 'ولي أمر تجريبي', guardianPhone: '۰۷۸۰۱۲۳۴۵۶۷', guardianConsent: true }), at);
  assert.deepEqual(persian.errors, {});
  assert.equal(persian.clean.birthYear, YEAR - 12);
  assert.equal(persian.clean.minor, true);
  assert.equal(persian.clean.guardianPhone, '07801234567');
  assert.equal(validateStudent(student({ birthYear: '1e3' }), at).errors.birthYear, 'اكتب سنة الميلاد بأربعة أرقام.');
  assert.equal(validateStudent(student({ birthYear: '12' }), at).errors.birthYear, 'اكتب سنة الميلاد بأربعة أرقام.');
});
const latinToPersian = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

test('after a failed check, focus goes to the first field with a problem in screen order', () => {
  // Screen order of step 1, whatever order the errors object was built in.
  assert.deepEqual(STUDENT_FIELDS, ['courseId', 'fullName', 'birthYear', 'phone', 'password', 'guardianName', 'guardianPhone', 'guardianConsent']);
  assert.deepEqual(errorTarget({ password: 'x', phone: 'x', q7: 'x' }, [7, 9]), { step: 0, field: 'phone' });
  assert.deepEqual(errorTarget({ guardianConsent: 'x', guardianPhone: 'x' }, []), { step: 0, field: 'guardianPhone' });
  assert.deepEqual(errorTarget({ fullName: 'x', courseId: 'x' }, []), { step: 0, field: 'courseId' });
  // The server answers «يوجد حساب بهذا الاسم ورقم الهاتف» on the phone, from the review step: back to step 1, on the phone.
  assert.deepEqual(errorTarget({ phone: 'x' }, [7, 9]), { step: 0, field: 'phone' });
  // Questionnaire: the first question on screen with an error, not the lowest id.
  assert.deepEqual(errorTarget({ q7: 'x', q9: 'x' }, [9, 7]), { step: 1, field: 'q9' });
  assert.deepEqual(errorTarget({ q9: 'x' }, [7, 9]), { step: 1, field: 'q9' });
  // An error about the whole form, or about a question that is no longer shown, has no field to land on.
  assert.deepEqual(errorTarget({ form: 'طلبات كثيرة' }, [7, 9]), { step: 2, field: null });
  assert.deepEqual(errorTarget({ q12: 'x' }, [7, 9]), { step: 2, field: null });
  assert.deepEqual(errorTarget({ q12: 'x', q7: 'x' }, [7, 9]), { step: 1, field: 'q7' });
});

test('the form moves focus only on a step change or a failed check, never while the user types', () => {
  const src = readFileSync('components/RegisterForm.tsx', 'utf8');
  // The focus effect runs when `move` changes and on nothing else: an effect that also depended on `errors` took focus
  // (and the phone keyboard) away at the first character typed into a field that had an error.
  const effect = src.slice(src.indexOf('useEffect('), src.indexOf('}, [', src.indexOf('useEffect(')) + 12);
  assert.match(effect, /\}, \[move\]\);/);
  assert.equal(src.match(/useEffect\(/g)?.length, 1);
  assert.match(src, /querySelector<HTMLElement>\(`\[name="\$\{move\.field\}"\]`\)/);
  // Every way of showing errors goes through show(), which asks errorTarget() where to land.
  assert.match(src, /function show\(found: FieldErrors\) \{\s+const target = errorTarget\(found, visible\.map\(\(q\) => q\.id\)\);/);
  assert.ok(!/setErrors\(found\)/.test(src.replace(/function show[\s\S]*?\n  \}/, '')));
});

test('the form keeps nothing on the device and adds no field (minors’ data)', () => {
  const src = readFileSync('components/RegisterForm.tsx', 'utf8') + readFileSync('components/Field.tsx', 'utf8') + readFileSync('app/register/page.tsx', 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|sendBeacon|gtag|analytics/i);
  const form = readFileSync('components/RegisterForm.tsx', 'utf8').replace(/<Icon [^>]*\/>/g, '');
  // Posted names: the eight fields of step 1, and the questionnaire answers. Nothing else carries a name.
  const names = [...form.matchAll(/fieldProps\('(\w+)'|name="(\w+)"/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual([...new Set(names)].sort(), [...STUDENT_FIELDS].sort());
  assert.deepEqual([...form.matchAll(/name=\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== 'key'), []);
});

test('each typed field asks the phone for the right keyboard and the right autofill', () => {
  const form = readFileSync('components/RegisterForm.tsx', 'utf8');
  const input = (id: string) => form.slice(form.indexOf(`fieldProps('${id}'`), form.indexOf('/>', form.indexOf(`fieldProps('${id}'`)));
  assert.match(input('fullName'), /autoComplete="section-student name"/);
  assert.match(input('birthYear'), /inputMode="numeric"/);
  assert.match(input('birthYear'), /autoComplete="off"/); // the phone's owner is usually the parent: their own birth year would hide the guardian block
  for (const [id, section] of [['phone', 'student'], ['guardianPhone', 'guardian']]) {
    assert.match(input(id), /type="tel"/);
    assert.match(input(id), /inputMode="tel"/);
    assert.match(input(id), new RegExp(`autoComplete="section-${section} tel-national"`));
    assert.match(input(id), /maxLength=\{40\}/); // room for «00964 (0) 770 - 123 - 4567» and pasted marks
  }
  assert.match(input('password'), /autoComplete="new-password"/);
  assert.match(input('guardianName'), /autoComplete="section-guardian name"/);
  for (const id of ['fullName', 'birthYear', 'phone', 'password', 'guardianName', 'guardianPhone']) assert.match(input(id), /enterKeyHint="next"/, id);
});

test('?course= preselects by id or by name, and only an open course', () => {
  const courses: OpenCourse[] = [
    { id: 3, name: 'دورة أحكام التجويد', kind: 'tajweed', teacher: 'أستاذ تجريبي', place: null },
    { id: 12, name: 'دورة الحفظ', kind: null, teacher: 'أستاذ تجريبي', place: null },
  ];
  assert.equal(pickCourse(courses, '12'), 12);
  assert.equal(pickCourse(courses, '١٢'), 12);
  assert.equal(pickCourse(courses, 'دورة الحفظ'), 12);
  assert.equal(pickCourse(courses, '  دورة   أحكام التجويد '), 3);
  assert.equal(pickCourse(courses, 'دورة أحكام التجويد'.normalize('NFD')), 3);
  assert.equal(pickCourse(courses, '1'), undefined); // not a prefix match
  assert.equal(pickCourse(courses, '99'), undefined);
  assert.equal(pickCourse(courses, 'دورة مغلقة'), undefined);
  assert.equal(pickCourse(courses, ''), undefined);
  assert.equal(pickCourse(courses, undefined), undefined);
  assert.equal(pickCourse([], '3'), undefined);
});

// ---------------------------------------------------------------- with the database
let db: Db;
let courseId: number;
before(async () => {
  db = await resetDbForTests();
  const [c] = await db.query<{ id: string }>(`insert into courses (name, kind, teacher, published) values ('دورة تجريبية', 'tajweed', 'أستاذ تجريبي', true) returning id`);
  courseId = Number(c.id);
});
after(async () => {
  await db.close();
});

test('a number typed in Persian digits with +964 is stored as 07XXXXXXXXX, and the student signs in with any spelling of it', async () => {
  const r = await register(db, student({ fullName: 'طالب أرقام تجريبي', phone: '+۹۶۴ (۰) ۷۷۰ ۱۲۳ ۹۹۰۱', birthYear: latinToPersian(String(YEAR - 12)), guardianName: 'ولي أمر تجريبي', guardianPhone: '٧٧٠١٢٣٩٩٠١', guardianConsent: true, courseId: String(courseId) }));
  assert.ok(r.ok, JSON.stringify(r));
  const [row] = await db.query<{ phone: string; guardian_phone: string; birth_year: number }>('select phone, guardian_phone, birth_year from students where id = $1', [r.studentId]);
  assert.deepEqual({ ...row }, { phone: '07701239901', guardian_phone: '07701239901', birth_year: YEAR - 12 });
  for (const typed of ['07701239901', '٠٧٧٠١٢٣٩٩٠١', '۰۷۷۰۱۲۳۹۹۰۱', '+964 770 123 9901', '7701239901']) {
    const login = await loginStudent(db, typed, 'password-1', '127.0.0.1');
    assert.ok(login.ok, typed);
  }
  // The same student again, spelled differently: the server's answer belongs to the phone field of step 1.
  const again = await register(db, student({ fullName: 'طالب أرقام تجريبي', phone: '0770 123 9901', courseId: String(courseId) }));
  assert.ok(!again.ok);
  assert.deepEqual(errorTarget(again.errors, []), { step: 0, field: 'phone' });
});

test('registering lands on the account page that says the request arrived', () => {
  assert.match(readFileSync('app/actions.ts', 'utf8'), /redirect\('\/account\?new=1'\)/);
  const page = readFileSync('app/account/page.tsx', 'utf8');
  // Only while a request is waiting, and with no promise of a delay that the school has not made.
  assert.match(page, /params\.new === '1' && requests\.some\(\(r\) => r\.status === 'pending'\)/);
  const done = page.slice(page.indexOf('className="card done"'), page.indexOf('</section>', page.indexOf('className="card done"')));
  assert.match(done, /role="status"/);
  assert.doesNotMatch(done, /ساعة|يوم|أيام|خلال|[٠-٩]/);
});
