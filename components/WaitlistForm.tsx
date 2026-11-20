'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import { waitlistAction, type WaitlistState } from '@/app/actions';
import { AGE_BANDS, ANY_COURSE } from '@/lib/waitlist-rules';
import { Field } from './Field';

export type WaitlistCourse = { id: number; name: string };

/**
 * «بلّغوني لما تنفتح»: the guardian's phone (required), and optionally a name, the course and the pupil's age band.
 * `course` fixes the course (a row in /courses); otherwise `courses` gives a choice with «أي دورة» first (/register).
 * `prefix` keeps ids unique when several forms are on one page.
 */
export function WaitlistForm({ prefix = 'wl', course, courses = [] }: { prefix?: string; course?: WaitlistCourse; courses?: WaitlistCourse[] }) {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(waitlistAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const id = (name: string) => `${prefix}-${name}`;

  useEffect(() => {
    if (!state) return;
    if (state.done) {
      thanks.current?.focus();
      return;
    }
    const root = form.current;
    (root?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? root?.querySelector<HTMLElement>('[data-summary]'))?.focus();
  }, [state]);

  if (state?.done) {
    return (
      <div className="wl-done" role="status" tabIndex={-1} ref={thanks}>
        <b>تمام، وصلنا رقمك.</b>
        <p>من تنفتح دورة{course ? ` «${course.name}»` : ''}، نراسلك على واتساب من رقم المدرسة. ما نگدر نحدد موعد هسه.</p>
        <p className="mute">إذا تريد نمسح رقمك، ردّ على رسالتنا بكلمة «إلغاء» أو راسلنا على واتساب المدرسة.</p>
      </div>
    );
  }

  const errors = state?.errors ?? {};
  const values = state?.values;
  const err = (name: string) => errors[name];
  const props = (name: string, { hint = false, required = false } = {}) => ({
    id: id(name),
    name,
    'aria-invalid': err(name) ? true : undefined,
    'aria-required': required ? true : undefined,
    'aria-describedby': err(name) ? `${id(name)}-err` : hint ? `${id(name)}-hint` : undefined,
  });
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form ref={form} action={action} noValidate className="wl-form" key={hasErrors ? JSON.stringify(values) : 'new'}>
      {hasErrors ? (
        <p className="alert bad" role="alert" tabIndex={-1} data-summary="">
          {errors.form ?? 'ما انحفظ الرقم. شوف الملاحظة تحت الحقل.'}
        </p>
      ) : null}
      {course ? <input type="hidden" name="courseId" value={course.id} /> : null}
      <Field id={id('phone')} label="رقم واتساب ولي الأمر" required hint="رقم عراقي، مثل 07701234567." error={err('phone')}>
        <input {...props('phone', { hint: true, required: true })} className="inp ltr" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} defaultValue={values?.phone ?? ''} />
      </Field>
      <Field id={id('guardianName')} label="اسم ولي الأمر (اختياري)" error={err('guardianName')}>
        <input {...props('guardianName')} className="inp" autoComplete="name" maxLength={80} defaultValue={values?.guardianName ?? ''} />
      </Field>
      {course ? null : (
        <Field id={id('courseId')} label="الدورة" error={err('courseId')}>
          <select {...props('courseId')} className="inp" defaultValue={values?.courseId ?? ANY_COURSE}>
            <option value={ANY_COURSE}>أي دورة</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id={id('ageBand')} label="عمر الطالب (اختياري)" error={err('ageBand')}>
        <select {...props('ageBand')} className="inp" defaultValue={values?.ageBand ?? ''}>
          <option value="">ما أريد أحدد</option>
          {AGE_BANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </Field>
      {/* Left empty by people; filled by form-filling bots. Out of sight and out of the tab order. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor={id('website')}>اتركه فارغاً</label>
        <input id={id('website')} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div className="field">
        <label className="opt">
          <input type="checkbox" id={id('consent')} name="consent" aria-invalid={err('consent') ? true : undefined} aria-describedby={err('consent') ? `${id('consent')}-err` : undefined} />
          <span>
            أوافق أن تحتفظ المدرسة بهذا الرقم حتى تبلّغني لما تنفتح دورة، حسب <Link href="/privacy#waitlist">سياسة الخصوصية</Link>.
          </span>
        </label>
        {err('consent') ? (
          <span className="err" id={`${id('consent')}-err`}>
            {err('consent')}
          </span>
        ) : null}
      </div>
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الحفظ…' : 'بلّغوني لما تنفتح'}
      </button>
    </form>
  );
}
