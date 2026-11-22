'use client';

import { useActionState, useState } from 'react';
import { loginAction } from '@/app/actions';
import { adminLoginAction } from '@/app/admin/actions';
import { Field, fieldProps } from './Field';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  // Controlled, so what was typed stays in place when the server answers with an error or asks which student.
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form action={action} noValidate>
      {state?.error ? (
        <p className="alert bad" role="alert">
          {state.error}
        </p>
      ) : null}
      <Field id="phone" label="رقم الهاتف">
        <input {...fieldProps('phone', { required: true, ltr: true })} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
      </Field>
      <Field id="password" label="كلمة المرور">
        <input {...fieldProps('password', { required: true, ltr: true })} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} />
      </Field>
      {state?.names ? (
        <p className="vh" role="status">
          أكثر من طالب مسجّل بهذا الرقم. اختر الاسم من القائمة ثم اضغط «دخول».
        </p>
      ) : null}
      {state?.names ? (
        <fieldset className="field">
          <legend className="lbl">أكثر من طالب مسجّل بهذا الرقم. اختر الاسم ثم اضغط «دخول»:</legend>
          <div className="opts">
            {state.names.map((name, i) => (
              <label className="opt" key={name}>
                <input type="radio" name="fullName" value={name} defaultChecked={i === 0} />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الدخول…' : 'دخول'}
      </button>
    </form>
  );
}

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLoginAction, undefined);
  const [email, setEmail] = useState('');
  // "تغيير" goes back to the address without touching the server; the next submit resets it.
  const [changing, setChanging] = useState(false);
  const onCodeStep = state?.step === 'code' && !changing;

  return (
    <form action={action} noValidate onSubmit={() => setChanging(false)}>
      {state?.error ? (
        <p className="alert bad" role="alert">
          {state.error}
        </p>
      ) : onCodeStep ? (
        <p className="alert ok" role="status">
          إذا كان هذا البريد مسجّلاً كمشرف، وصلك رمز الدخول.
        </p>
      ) : null}

      {onCodeStep ? (
        <>
          <input type="hidden" name="email" value={state.email} />
          <Field id="code" label="رمز الدخول" hint="ستة أرقام وصلتك بالبريد، صالحة عشر دقائق">
            <input {...fieldProps('code', { hint: true, required: true, ltr: true })} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          </Field>
          <button className="btn k" type="submit" name="intent" value="verify" disabled={pending}>
            {pending ? 'جارٍ الدخول…' : 'دخول الإدارة'}
          </button>
          <p className="alt">
            <span dir="ltr">{state.email}</span>{' · '}
            <button className="linkbtn" type="button" onClick={() => setChanging(true)}>
              تغيير البريد
            </button>
            {' · '}
            <button className="linkbtn" type="submit" name="intent" value="request" disabled={pending}>
              إعادة إرسال الرمز
            </button>
          </p>
        </>
      ) : (
        <>
          <Field id="email" label="البريد الإلكتروني">
            <input {...fieldProps('email', { required: true, ltr: true })} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
          </Field>
          <button className="btn k" type="submit" name="intent" value="request" disabled={pending}>
            {pending ? 'جارٍ الإرسال…' : 'إرسال رمز الدخول'}
          </button>
        </>
      )}
    </form>
  );
}
