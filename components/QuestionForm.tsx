'use client';

import { useActionState, useState } from 'react';
import { addQuestionAction } from '@/app/admin/actions';
import type { QuestionKind } from '@/lib/form-rules';
import { Field, fieldProps } from './Field';

const KINDS: { value: QuestionKind; label: string }[] = [
  { value: 'single', label: 'اختيار إجابة واحدة' },
  { value: 'multi', label: 'اختيار أكثر من إجابة' },
  { value: 'yes_no', label: 'نعم أو لا' },
  { value: 'text', label: 'إجابة مكتوبة' },
];

/** conditions: answers of earlier questions that a new question can depend on, as "<id>|<answer>". */
export function QuestionForm({ conditions }: { conditions: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(addQuestionAction, undefined);
  const [kind, setKind] = useState<QuestionKind>('single');
  const hasOptions = kind === 'single' || kind === 'multi';

  return (
    // The key remounts the form after each saved question, which clears it.
    <form action={action} key={state?.saved ?? 0} noValidate>
      {state?.error ? (
        <p className="alert bad" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.saved && !state.error ? (
        <p className="alert ok" role="status">
          أُضيف السؤال إلى آخر الاستبيان.
        </p>
      ) : null}
      <Field id="label" label="نص السؤال" required>
        <input {...fieldProps('label')} maxLength={200} required />
      </Field>
      <Field id="kind" label="نوع الإجابة" required>
        <select {...fieldProps('kind')} value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      {hasOptions ? (
        <Field id="options" label="الخيارات" hint="كل خيار في سطر، من خيارين إلى ١٢ خياراً." required>
          <textarea {...fieldProps('options', undefined, 'hint')} rows={4} />
        </Field>
      ) : null}
      <Field id="showIf" label="متى يظهر السؤال" hint="يمكن ربطه بإجابة سؤال سابق.">
        <select {...fieldProps('showIf', undefined, 'hint')} defaultValue="">
          <option value="">يظهر دائماً</option>
          {conditions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <label className="opt">
        <input type="checkbox" name="required" />
        سؤال مطلوب
      </label>
      <button className="btn k" type="submit" disabled={pending} style={{ marginTop: 16 }}>
        {pending ? 'جارٍ الحفظ…' : 'إضافة السؤال'}
      </button>
    </form>
  );
}
