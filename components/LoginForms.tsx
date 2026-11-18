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
        <input {...fieldProps('phone')} className="inp ltr" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} required />
      </Field>
      <Field id="password" label="كلمة المرور">
        <input {...fieldProps('password')} className="inp ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} required />
      </Field>
      {state?.names ? (
        <fieldset className="field">
          <legend className="lbl">أكثر من طالب مسجّل بهذا الرقم. اختر اسمك:</legend>
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

  return (
    <form action={action} noValidate>
      {state?.error ? (
        <p className="alert bad" role="alert">
          {state.error}
        </p>
      ) : null}
      <Field id="email" label="البريد الإلكتروني">
        <input {...fieldProps('email')} className="inp ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required />
      </Field>
      <Field id="password" label="كلمة المرور">
        <input {...fieldProps('password')} className="inp ltr" type="password" autoComplete="current-password" maxLength={200} required />
      </Field>
      <Field id="code" label="رمز التحقق" hint="ستة أرقام من تطبيق المصادقة">
        <input {...fieldProps('code', undefined, 'hint')} className="inp ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      </Field>
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الدخول…' : 'دخول الإدارة'}
      </button>
    </form>
  );
}
