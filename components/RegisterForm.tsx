'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { registerAction, type RegisterState } from '@/app/actions';
import { isMinorIn, MAX_NAME, MIN_PASSWORD, NO, normalizePhone, toYear, visibleQuestions, YES, type Answers, type FieldErrors, type FormQuestion, type OpenCourse } from '@/lib/form-rules';
import { Field, fieldProps } from './Field';
import { Icon } from './Icon';
import { Logo } from './SiteChrome';

const STEPS = [
  { title: 'بيانات الطالب', sub: 'الاسم، سنة الميلاد، رقم الهاتف', lead: 'نطلب أقل ما يلزم للتواصل وفتح حساب الطالب.' },
  { title: 'استبيان التسجيل', sub: 'أسئلة قصيرة عن مستوى الطالب', lead: 'يساعد الأستاذ على معرفة مستوى الطالب ووضعه في الحلقة المناسبة.' },
  { title: 'المراجعة والإرسال', sub: 'ثم تراجع الإدارة الطلب', lead: 'راجع البيانات قبل الإرسال. يمكنك الرجوع وتعديل أي شيء.' },
];
const AR = new Intl.NumberFormat('ar-EG');
const STUDENT_FIELDS = ['fullName', 'birthYear', 'phone', 'password', 'courseId', 'guardianName', 'guardianPhone', 'guardianConsent'];
const YEAR_SHAPE = /^[0-9٠-٩]{4}$/;

type Student = { fullName: string; birthYear: string; phone: string; password: string; courseId: string; guardianName: string; guardianPhone: string; guardianConsent: boolean };

/** The step that holds the first error, so the user lands where the problem is. Errors about the whole form stay on the last step. */
const stepOf = (errors: FieldErrors) => (Object.keys(errors).some((k) => STUDENT_FIELDS.includes(k)) ? 0 : Object.keys(errors).some((k) => /^q\d+$/.test(k)) ? 1 : 2);

const without = (errors: FieldErrors, key: string) => Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key));

export function RegisterForm({ courses, questions, preselect, thisYear }: { courses: OpenCourse[]; questions: FormQuestion[]; preselect?: number; thisYear: number }) {
  const [step, setStep] = useState(0);
  const [s, setS] = useState<Student>({ fullName: '', birthYear: '', phone: '', password: '', courseId: preselect ? String(preselect) : '', guardianName: '', guardianPhone: '', guardianConsent: false });
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const main = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const focusError = useRef(false);

  const [, formAction, pending] = useActionState(async (prev: RegisterState, form: FormData) => {
    const result = await registerAction(prev, form);
    if (result?.errors) show(result.errors, stepOf(result.errors));
    return result;
  }, undefined);

  // After a step change or a failed check, put focus where the user needs to act next:
  // the first field with a problem, or else the step title.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const bad = focusError.current ? main.current?.querySelector<HTMLElement>('[aria-invalid="true"]') : null;
    focusError.current = false;
    (bad ?? heading.current)?.focus();
  }, [step, errors]);

  // The guardian block shows for a minor, and also whenever the server asks for guardian details,
  // so an error can never point at a field that is not on screen.
  const minor = (YEAR_SHAPE.test(s.birthYear.trim()) && isMinorIn(toYear(s.birthYear), thisYear)) || Boolean(errors.guardianName || errors.guardianPhone || errors.guardianConsent);
  const visible = visibleQuestions(questions, answers);
  const course = courses.find((c) => String(c.id) === s.courseId);
  const shownKeys = new Set([...STUDENT_FIELDS, 'form', ...visible.map((q) => `q${q.id}`)]);
  const stale = Object.keys(errors).some((k) => !shownKeys.has(k));

  function show(found: FieldErrors, at: number) {
    focusError.current = true;
    setErrors(found);
    setStep(at);
  }

  const set = <K extends keyof Student>(key: K, value: Student[K]) => {
    setS((old) => ({ ...old, [key]: value }));
    if (errors[key]) setErrors((old) => without(old, key));
  };
  const answer = (q: FormQuestion, value: string | string[]) => {
    setAnswers((old) => ({ ...old, [String(q.id)]: value }));
    if (errors[`q${q.id}`]) setErrors((old) => without(old, `q${q.id}`));
  };

  /** A light check before moving on. The server runs the full validation on submit. */
  function check(at: number): FieldErrors {
    const e: FieldErrors = {};
    if (at === 0) {
      if (!s.courseId) e.courseId = 'اختر الدورة التي تريد التسجيل فيها.';
      if (s.fullName.trim().split(/\s+/).length < 2) e.fullName = 'اكتب الاسم الثنائي على الأقل.';
      if (!YEAR_SHAPE.test(s.birthYear.trim())) e.birthYear = 'اكتب سنة الميلاد بأربعة أرقام.';
      else if (toYear(s.birthYear) < thisYear - 90 || toYear(s.birthYear) > thisYear - 5) e.birthYear = 'سنة الميلاد غير صحيحة.';
      if (!normalizePhone(s.phone)) e.phone = 'اكتب رقم هاتف عراقياً صحيحاً، مثل 07701234567.';
      if (s.password.length < MIN_PASSWORD) e.password = `كلمة المرور ${AR.format(MIN_PASSWORD)} خانات على الأقل.`;
      if (minor) {
        if (s.guardianName.trim().length < 5) e.guardianName = 'اكتب اسم ولي الأمر.';
        if (!normalizePhone(s.guardianPhone)) e.guardianPhone = 'اكتب رقم هاتف ولي الأمر.';
        if (!s.guardianConsent) e.guardianConsent = 'التسجيل لمن هو دون ١٨ سنة يحتاج موافقة ولي الأمر.';
      }
    } else if (at === 1) {
      for (const q of visible) {
        const v = answers[String(q.id)];
        if (q.required && (v === undefined || v === '' || (Array.isArray(v) && v.length === 0))) e[`q${q.id}`] = 'هذا السؤال مطلوب.';
      }
    }
    return e;
  }

  function next() {
    const found = check(step);
    if (Object.keys(found).length) show(found, step);
    else {
      setErrors({});
      setStep(step + 1);
    }
  }

  function onSubmit(event: FormEvent) {
    if (step < 2) {
      event.preventDefault(); // Enter in a field moves to the next step instead of sending early
      next();
    }
  }

  return (
    <div className="reg">
      <aside className="reg-side">
        <Logo mark="yellow" />
        <h1>
          التسجيل في <em>{course ? course.name : 'مدرسة نور الأوصياء'}</em>
        </h1>
        <p>{course ? `بإشراف ${course.teacher}` : 'اختر الدورة وأجب عن استبيان قصير، ثم تراجع الإدارة الطلب.'}</p>
        <ol className="vsteps">
          {STEPS.map((st, i) => (
            <li key={st.title} className={`vs${i < step ? ' dn' : i === step ? ' on' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <span className="n">{i < step ? <Icon name="check" size="s" /> : AR.format(i + 1)}</span>
              <div>
                <b>{st.title}</b>
                <span>{st.sub}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="priv">
          <Icon name="shield" />
          <span>
            <b>بياناتك عندنا</b>
            <br />
            نطلب أقل ما يلزم فقط. من هو دون ١٨ سنة يُسجَّل باسم ولي الأمر ورقمه وموافقته، ولا تُعرض البيانات لغير إدارة المدرسة. <Link href="/privacy">سياسة الخصوصية</Link>
          </span>
        </div>
      </aside>

      <main className="reg-main" id="main" ref={main}>
        <div className="reg-top">
          <span>الخطوة {AR.format(step + 1)} من ٣</span>
          <div className="bar-p" aria-hidden="true">
            <i style={{ width: `${((step + 1) / 3) * 100}%` }} />
          </div>
          <Link className="sp" href="/login">
            عندي حساب
          </Link>
        </div>
        <h2 ref={heading} tabIndex={-1}>
          {STEPS[step].title}
        </h2>
        <p className="sub">{STEPS[step].lead}</p>
        <noscript>
          <p className="alert info">التسجيل من الموقع يحتاج تفعيل جافاسكربت في المتصفح. يمكنك أيضاً التسجيل عبر واتساب أو هاتف المدرسة من أسفل الصفحة الرئيسية.</p>
        </noscript>
        {Object.keys(errors).length > 0 ? (
          <p className="alert bad" role="alert">
            {errors.form ?? (stale ? 'تغيّر استبيان التسجيل أثناء تعبئته. حدّث الصفحة ثم أعد المحاولة.' : 'بعض الحقول تحتاج تصحيحاً. راجع الملاحظات تحت كل حقل.')}
          </p>
        ) : null}

        <form action={formAction} onSubmit={onSubmit} noValidate>
          <div hidden={step !== 0}>
            <div className="card q">
              <Field id="courseId" label="الدورة" error={errors.courseId} required>
                <select {...fieldProps('courseId', { error: errors.courseId, required: true })} value={s.courseId} onChange={(e) => set('courseId', e.target.value)}>
                  <option value="">اختر الدورة</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.teacher}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="fullName" label="اسم الطالب الكامل" error={errors.fullName} required>
                <input {...fieldProps('fullName', { error: errors.fullName, required: true })} value={s.fullName} onChange={(e) => set('fullName', e.target.value)} autoComplete="name" maxLength={MAX_NAME} />
              </Field>
              <div className="two">
                <Field id="birthYear" label="سنة الميلاد" hint="السنة فقط، مثل 2008" error={errors.birthYear} required>
                  <input {...fieldProps('birthYear', { error: errors.birthYear, hint: true, required: true, ltr: true })} value={s.birthYear} onChange={(e) => set('birthYear', e.target.value)} inputMode="numeric" maxLength={4} autoComplete="bday-year" />
                </Field>
                <Field id="phone" label="رقم الهاتف" hint="به تدخل إلى الحساب. إن لم يكن للطالب هاتف فاكتب رقم ولي الأمر." error={errors.phone} required>
                  <input {...fieldProps('phone', { error: errors.phone, hint: true, required: true, ltr: true })} value={s.phone} onChange={(e) => set('phone', e.target.value)} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} />
                </Field>
              </div>
              <Field id="password" label="كلمة المرور" hint={`${AR.format(MIN_PASSWORD)} خانات على الأقل. احفظها لمتابعة الطلب والدروس.`} error={errors.password} required>
                <input {...fieldProps('password', { error: errors.password, hint: true, required: true, ltr: true })} value={s.password} onChange={(e) => set('password', e.target.value)} type="password" autoComplete="new-password" maxLength={200} />
              </Field>
            </div>

            {minor ? (
              <div className="card q">
                <h3 className="qh">ولي الأمر</h3>
                <p className="h">الطالب دون ١٨ سنة، فنحتاج اسم ولي الأمر ورقمه وموافقته.</p>
                <div className="two">
                  <Field id="guardianName" label="اسم ولي الأمر" error={errors.guardianName} required>
                    <input {...fieldProps('guardianName', { error: errors.guardianName, required: true })} value={s.guardianName} onChange={(e) => set('guardianName', e.target.value)} maxLength={MAX_NAME} />
                  </Field>
                  <Field id="guardianPhone" label="رقم هاتف ولي الأمر" error={errors.guardianPhone} required>
                    <input {...fieldProps('guardianPhone', { error: errors.guardianPhone, required: true, ltr: true })} value={s.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} type="tel" inputMode="tel" maxLength={20} />
                  </Field>
                </div>
                <label className="opt">
                  <input
                    type="checkbox"
                    name="guardianConsent"
                    checked={s.guardianConsent}
                    onChange={(e) => set('guardianConsent', e.target.checked)}
                    aria-required="true"
                    aria-invalid={errors.guardianConsent ? true : undefined}
                    aria-describedby={errors.guardianConsent ? 'guardianConsent-err' : undefined}
                  />
                  <span>
                    أنا ولي الأمر، وأوافق على تسجيل الطالب وحفظ بياناته كما في{' '}
                    <Link href="/privacy" target="_blank">
                      سياسة الخصوصية
                    </Link>
                    .
                  </span>
                </label>
                {errors.guardianConsent ? (
                  <span className="err" id="guardianConsent-err">
                    {errors.guardianConsent}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div hidden={step !== 1}>
            {visible.length === 0 ? <p className="card empty">لا توجد أسئلة في الاستبيان حالياً. انتقل إلى المراجعة.</p> : null}
            {visible.map((q, i) => {
              const key = `q${q.id}`;
              const value = answers[String(q.id)];
              const options = q.kind === 'yes_no' ? [YES, NO] : q.options;
              const invalid = errors[key] ? true : undefined;
              return (
                <fieldset className="card q" key={q.id} aria-describedby={errors[key] ? `${key}-err` : undefined}>
                  <legend className="qh">
                    <span className="qn">{AR.format(i + 1)}</span>
                    {q.label}
                    {q.required ? <em aria-hidden="true"> *</em> : null}
                    {q.required ? <span className="vh"> (مطلوب)</span> : null}
                  </legend>
                  {q.kind === 'text' ? (
                    <textarea className="inp" name={key} aria-label={q.label} value={typeof value === 'string' ? value : ''} onChange={(e) => answer(q, e.target.value)} maxLength={500} aria-invalid={invalid} aria-required={q.required || undefined} />
                  ) : (
                    <>
                      <p className="h">{q.kind === 'multi' ? 'يمكن اختيار أكثر من إجابة' : 'اختر إجابة واحدة'}</p>
                      <div className={`opts${options.length === 2 ? ' c2' : options.length > 4 ? ' c4' : ''}`}>
                        {options.map((o, n) => {
                          const list = Array.isArray(value) ? value : [];
                          return q.kind === 'multi' ? (
                            <label className="opt" key={o}>
                              <input type="checkbox" name={key} value={o} checked={list.includes(o)} onChange={(e) => answer(q, e.target.checked ? [...list, o] : list.filter((x) => x !== o))} aria-invalid={n === 0 ? invalid : undefined} />
                              {o}
                            </label>
                          ) : (
                            <label className="opt" key={o}>
                              <input type="radio" name={key} value={o} checked={value === o} onChange={() => answer(q, o)} aria-invalid={n === 0 ? invalid : undefined} />
                              {o}
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {errors[key] ? (
                    <span className="err" id={`${key}-err`}>
                      {errors[key]}
                    </span>
                  ) : null}
                </fieldset>
              );
            })}
          </div>

          <div hidden={step !== 2}>
            <div className="card q">
              <h3 className="qh">بيانات الطالب</h3>
              <dl className="sum">
                <div>
                  <dt>الدورة</dt>
                  <dd>{course ? `${course.name} · ${course.teacher}` : ''}</dd>
                </div>
                <div>
                  <dt>اسم الطالب</dt>
                  <dd>{s.fullName}</dd>
                </div>
                <div>
                  <dt>سنة الميلاد</dt>
                  <dd className="num">{s.birthYear}</dd>
                </div>
                <div>
                  <dt>رقم الهاتف</dt>
                  <dd className="num">{s.phone}</dd>
                </div>
                {minor ? (
                  <div>
                    <dt>ولي الأمر</dt>
                    <dd>
                      {s.guardianName} · <span className="num">{s.guardianPhone}</span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
            {visible.length > 0 ? (
              <div className="card q">
                <h3 className="qh">إجابات الاستبيان</h3>
                <dl className="sum">
                  {visible.map((q) => {
                    const v = answers[String(q.id)];
                    const shown = Array.isArray(v) ? v.join('، ') : v;
                    return (
                      <div key={q.id}>
                        <dt>{q.label}</dt>
                        <dd>{shown || <span className="na">بلا إجابة</span>}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ) : null}
            <p className="alert info">بعد الإرسال تراجع إدارة المدرسة الطلب، وتظهر النتيجة في الحساب عند الدخول برقم الهاتف وكلمة المرور.</p>
          </div>

          <div className="reg-acts">
            {step > 0 ? (
              <button type="button" className="btn w" onClick={() => setStep(step - 1)} disabled={pending}>
                السابق
              </button>
            ) : null}
            {step < 2 ? (
              // Separate keys: without them React reuses one <button> and turns it into type="submit" during the
              // click on step 2, so the browser sent the form before the review step.
              <button key="next" type="button" className="btn k" onClick={next}>
                التالي: {STEPS[step + 1].title}
                <Icon name="chev" size="s" />
              </button>
            ) : (
              <button key="submit" type="submit" className="btn k" disabled={pending}>
                {pending ? 'جارٍ الإرسال…' : 'إرسال الطلب'}
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
