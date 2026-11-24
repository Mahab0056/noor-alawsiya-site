'use client';

import { useActionState, useState } from 'react';
import { addCourseAction, type CourseState } from '@/app/admin/courses/actions';
import { Field, fieldProps } from './Field';

const EMPTY = { name: '', teacher: '', place: '', startedOn: '', open: false, seats: '' };

/**
 * «دورة جديدة». What the admin typed stays when the server reports a problem, and clears only after a save.
 * `seats`: COURSE_SEATS is on, so the form also asks for «عدد المقاعد» (empty = no limit).
 */
export function CourseForm({ seats = false }: { seats?: boolean }) {
  const [f, setF] = useState(EMPTY);
  const [state, action, pending] = useActionState(async (prev: CourseState, form: FormData) => {
    const result = await addCourseAction(prev, form);
    if (result?.saved) setF(EMPTY);
    return result;
  }, undefined);
  const e = state?.errors ?? {};

  return (
    <form action={action} noValidate>
      {state?.error ? (
        <p className="alert bad" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.saved ? (
        <p className="alert ok" role="status">
          أُضيفت الدورة إلى القائمة.
        </p>
      ) : null}
      <Field id="name" label="اسم الدورة" required error={e.name}>
        <input {...fieldProps('name', { required: true, error: e.name })} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} maxLength={120} />
      </Field>
      <Field id="teacher" label="المدرّس" required error={e.teacher}>
        <input {...fieldProps('teacher', { required: true, error: e.teacher })} value={f.teacher} onChange={(ev) => setF({ ...f, teacher: ev.target.value })} maxLength={120} />
      </Field>
      <Field id="place" label="المكان" hint="الجامع أو الحسينية والمنطقة." error={e.place}>
        <input {...fieldProps('place', { hint: true, error: e.place })} value={f.place} onChange={(ev) => setF({ ...f, place: ev.target.value })} maxLength={160} />
      </Field>
      <Field id="startedOn" label="موعد البدء" hint="كما تكتبه المدرسة، مثل: ٢٦ أيلول ٢٠٢٦." error={e.startedOn}>
        <input {...fieldProps('startedOn', { hint: true, error: e.startedOn })} value={f.startedOn} onChange={(ev) => setF({ ...f, startedOn: ev.target.value })} maxLength={60} />
      </Field>
      {seats ? (
        <Field id="seats" label="عدد المقاعد" hint="اتركه فارغاً إن لم يكن للحلقة حد. حين يكتمل بالطلبات المقبولة يُغلق التسجيل وحده." error={e.seats}>
          <input {...fieldProps('seats', { hint: true, error: e.seats, ltr: true })} value={f.seats} onChange={(ev) => setF({ ...f, seats: ev.target.value })} inputMode="numeric" maxLength={4} />
        </Field>
      ) : null}
      <label className="opt">
        <input type="checkbox" name="open" checked={f.open} onChange={(ev) => setF({ ...f, open: ev.target.checked })} />
        تقبل التسجيل من الموقع الآن
      </label>
      <button className="btn k" type="submit" disabled={pending} style={{ marginTop: 16 }}>
        {pending ? 'جارٍ الحفظ…' : 'إضافة الدورة'}
      </button>
    </form>
  );
}
