'use client';

import { useActionState, useState } from 'react';
import { addQuestionAction, type QuestionState } from '@/app/admin/actions';
import type { QuestionKind } from '@/lib/form-rules';
import { Field, fieldProps } from './Field';

const KINDS: { value: QuestionKind; label: string }[] = [
  { value: 'single', label: 'اختيار إجابة واحدة' },
  { value: 'multi', label: 'اختيار أكثر من إجابة' },
  { value: 'yes_no', label: 'نعم أو لا' },
  { value: 'text', label: 'إجابة مكتوبة' },
];

const EMPTY = { label: '', kind: 'single' as QuestionKind, options: '', showIf: '', required: false };

/** conditions: answers of earlier questions that a new question can depend on, as "<id>|<answer>". */
export function QuestionForm({ conditions }: { conditions: { value: string; label: string }[] }) {
  // Controlled fields: what the admin typed stays when the server reports a problem, and clears only after a save.
  const [f, setF] = useState(EMPTY);
  const [state, action, pending] = useActionState(async (prev: QuestionState, form: FormData) => {
    const result = await addQuestionAction(prev, form);
    if (result && !result.error) setF(EMPTY);
    return result;
  }, undefined);
  const hasOptions = f.kind === 'single' || f.kind === 'multi';
  const error = state?.error;

  return (
    <form action={action} noValidate>
      {error ? (
        <p className="alert bad" role="alert">
          {error}
        </p>
      ) : null}
      {state?.saved && !error ? (
        <p className="alert ok" role="status">
          أُضيف السؤال إلى آخر الاستبيان.
        </p>
      ) : null}
      <Field id="label" label="نص السؤال" required>
        <input {...fieldProps('label', { required: true })} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={200} />
      </Field>
      <Field id="kind" label="نوع الإجابة" required>
        <select {...fieldProps('kind', { required: true })} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as QuestionKind })}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      {hasOptions ? (
        <Field id="options" label="الخيارات" hint="كل خيار في سطر، من خيارين إلى ١٢ خياراً." required>
          <textarea {...fieldProps('options', { hint: true, required: true })} rows={4} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />
        </Field>
      ) : null}
      <Field id="showIf" label="متى يظهر السؤال" hint="يمكن ربطه بإجابة سؤال سابق.">
        <select {...fieldProps('showIf', { hint: true })} value={f.showIf} onChange={(e) => setF({ ...f, showIf: e.target.value })}>
          <option value="">يظهر دائماً</option>
          {conditions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <label className="opt">
        <input type="checkbox" name="required" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />
        سؤال مطلوب
      </label>
      <button className="btn k" type="submit" disabled={pending} style={{ marginTop: 16 }}>
        {pending ? 'جارٍ الحفظ…' : 'إضافة السؤال'}
      </button>
    </form>
  );
}
