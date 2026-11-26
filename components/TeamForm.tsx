'use client';

import { useActionState, useState } from 'react';
import { addAdminAction, type TeamState } from '@/app/admin/team/actions';
import { Field, fieldProps } from './Field';

const EMPTY = { name: '', email: '' };

export function TeamForm() {
  const [f, setF] = useState(EMPTY);
  const [state, action, pending] = useActionState(async (prev: TeamState, form: FormData) => {
    const result = await addAdminAction(prev, form);
    if (result && !result.error) setF(EMPTY);
    return result;
  }, undefined);
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
          أُضيف المشرف. يدخل من صفحة دخول الإدارة ببريده، ويصله رمز الدخول عليه.
        </p>
      ) : null}
      <Field id="name" label="الاسم" required>
        <input {...fieldProps('name', { required: true })} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} autoComplete="off" />
      </Field>
      <Field id="email" label="البريد الإلكتروني" hint="رمز الدخول يصل إلى هذا البريد في كل مرة." required>
        <input {...fieldProps('email', { hint: true, required: true, ltr: true })} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={200} autoComplete="off" />
      </Field>
      <button className="btn k" type="submit" disabled={pending} style={{ marginTop: 4 }}>
        {pending ? 'جارٍ الحفظ…' : 'إضافة مشرف عام'}
      </button>
    </form>
  );
}
