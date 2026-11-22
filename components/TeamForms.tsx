'use client';

import { useActionState, useState } from 'react';
import { disableAction, inviteAction, resendAction, revokeAction, unlockAction, type TeamState } from '@/app/admin/admins/actions';
import { Field, fieldProps } from './Field';

function Status({ state }: { state: TeamState }) {
  if (state?.error) return <p className="alert bad" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="alert ok" role="status">{state.ok}</p>;
  return null;
}

/** `teachers`: offer the «أستاذ» role (only while PROGRESS_TRACKING is on). */
export function InviteAdminForm({ teachers = false }: { teachers?: boolean }) {
  const [state, action, pending] = useActionState(inviteAction, undefined);
  // Controlled, so what was typed stays in place when the server answers with an error.
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  return (
    <form action={action} noValidate>
      <Status state={state} />
      <Field id="email" label="البريد الإلكتروني">
        <input {...fieldProps('email', { required: true, ltr: true })} type="email" autoComplete="off" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id="role" label="الدور">
        <select {...fieldProps('role')} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="staff">مشرف: يراجع الطلبات ويعدّل الاستبيان</option>
          {teachers ? <option value="teacher">أستاذ: يسجّل حضور حلقاته فقط، ولا يرى الطلبات ولا الأرقام</option> : null}
          <option value="super_admin">مدير أعلى: كل ما سبق، ويدعو المشرفين ويوقفهم</option>
        </select>
      </Field>
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الإرسال…' : 'إرسال الدعوة'}
      </button>
    </form>
  );
}

const ACTIONS = { resend: resendAction, revoke: revokeAction, disable: disableAction, unlock: unlockAction };

/** One small button that runs one super-admin action on one admin. */
export function RowAction({ kind, id, label, danger, extra }: { kind: keyof typeof ACTIONS; id: number; label: string; danger?: boolean; extra?: Record<string, string> }) {
  const [state, action, pending] = useActionState(ACTIONS[kind], undefined);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={`btn sm ${danger ? 'no' : 'w'}`} type="submit" disabled={pending}>
        {label}
      </button>
      {state?.error ? <span className="err" role="alert"> {state.error}</span> : state?.ok ? <span className="mute" role="status"> {state.ok}</span> : null}
    </form>
  );
}
