'use client';

import { useActionState, useEffect, useRef } from 'react';
import { requestCourseAction, type CourseRequestState } from '@/app/actions';
import { Field, fieldProps } from './Field';

export type CourseOption = { id: number; label: string; taken: 'pending' | 'accepted' | null };

const TAKEN_LABEL = { pending: 'طلبك قيد المراجعة', accepted: 'مقبول' } as const;
const MAX_NOTE = 300;

/** «اطلب دورة ثانية»: a course, an optional note and, for a minor, the guardian's agreement to this request. */
export function CourseRequestForm({ courses, minor, guardianMasked }: { courses: CourseOption[]; minor: boolean; guardianMasked: string | null }) {
  const [state, action, pending] = useActionState<CourseRequestState, FormData>(requestCourseAction, undefined);
  const errors = state?.errors ?? {};
  const form = useRef<HTMLFormElement>(null);

  // After a refusal, move focus to the first field with a problem (or the message above the form).
  useEffect(() => {
    if (!state) return;
    const root = form.current;
    (root?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? root?.querySelector<HTMLElement>('[data-summary]'))?.focus();
  }, [state]);

  const hasErrors = Object.keys(errors).length > 0;
  // React clears a form after its action. Keying the form on the answer count starts it again from what was sent, so the
  // course and the note stay in place, while the guardian's tick starts empty: it is given again for every attempt.
  return (
    <form ref={form} key={state?.sent ?? 0} action={action} noValidate className="creq">
      {hasErrors ? (
        <p className="alert bad" role="alert" tabIndex={-1} data-summary="">
          {errors.form ?? 'لم يُرسل الطلب. راجع الملاحظة تحت الحقل.'}
        </p>
      ) : null}
      <Field id="courseId" label="الدورة" required error={errors.courseId}>
        <select {...fieldProps('courseId', { error: errors.courseId, required: true })} defaultValue={state?.courseId ?? ''}>
          <option value="">اختر دورة…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id} disabled={c.taken !== null}>
              {c.taken ? `${c.label} (${TAKEN_LABEL[c.taken]})` : c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="note" label="ملاحظة للإدارة (اختياري)" hint={`حتى ${MAX_NOTE} حرف، مثل الوقت الذي يناسبك.`} error={errors.note}>
        <textarea {...fieldProps('note', { error: errors.note, hint: true })} maxLength={MAX_NOTE} rows={3} defaultValue={state?.note ?? ''} />
      </Field>
      {minor ? (
        <div className="field">
          <p className="hint" id="guardianConsent-hint">
            ولي الأمر المسجّل في حسابك: <b>{guardianMasked}</b>. لا نطلب بيانات جديدة؛ نحتاج موافقته على هذا الطلب.
          </p>
          <label className="opt">
            <input
              type="checkbox"
              id="guardianConsent"
              name="guardianConsent"
              aria-invalid={errors.guardianConsent ? true : undefined}
              aria-describedby={errors.guardianConsent ? 'guardianConsent-err guardianConsent-hint' : 'guardianConsent-hint'}
            />
            ولي الأمر موافق على هذا الطلب
          </label>
          {errors.guardianConsent ? (
            <span className="err" id="guardianConsent-err">
              {errors.guardianConsent}
            </span>
          ) : null}
        </div>
      ) : null}
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الإرسال…' : 'أرسل الطلب'}
      </button>
    </form>
  );
}
