'use client';

import { useActionState } from 'react';
import { inviteAction } from '@/app/admin/invite/actions';
import { Field, fieldProps } from './Field';

/** One step: the admin's name. The account is active and signed in at once (the link came by e-mail). */
export function InviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(inviteAction, undefined);

  if (state?.step === 'dead') {
    return (
      <p className="alert bad" role="alert">
        {state.error}
      </p>
    );
  }

  const errors = state?.step === 'name' ? state.errors : undefined;
  return (
    <form action={action} noValidate>
      <input type="hidden" name="token" value={token} />
      {state?.error ? (
        <p className="alert bad" role="alert">
          {state.error}
        </p>
      ) : null}
      <Field id="name" label="الاسم" error={errors?.name} required>
        <input {...fieldProps('name', { error: errors?.name, required: true })} autoComplete="name" maxLength={80} />
      </Field>
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الحفظ…' : 'حفظ والدخول'}
      </button>
    </form>
  );
}
