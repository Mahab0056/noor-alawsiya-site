'use client';

import { useActionState } from 'react';
import { inviteAction } from '@/app/admin/invite/actions';
import { Field, fieldProps } from './Field';

/**
 * Default: one step, name and password; the account is active and signed in at once (the link came by e-mail).
 * With `appCode` (ADMIN_TOTP=1) two steps: 1: name and password; the server proposes an authenticator secret and shows
 * it once (QR + key). 2: one valid code from the app; only then is the account active and signed in.
 */
export function InviteForm({ token, appCode = false }: { token: string; appCode?: boolean }) {
  const [state, action, pending] = useActionState(inviteAction, undefined);

  if (state?.step === 'dead') {
    return (
      <p className="alert bad" role="alert">
        {state.error}
      </p>
    );
  }

  if (state?.step === 'totp') {
    return (
      <form action={action} noValidate>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="step" value="code" />
        {state.error ? (
          <p className="alert bad" role="alert">
            {state.error}
          </p>
        ) : null}
        <p className="alert info">
          افتح تطبيق المصادقة (Google Authenticator أو Microsoft Authenticator) واختر «إضافة حساب» ثم امسح الرمز. هذا الرمز يظهر الآن فقط.
        </p>
        <p style={{ textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline data URL made on the server, nothing to optimise */}
          <img src={state.qr} alt="رمز QR لإضافة الحساب إلى تطبيق المصادقة" width={220} height={220} style={{ imageRendering: 'pixelated', width: 220, height: 220 }} />
        </p>
        <p className="mute" style={{ fontSize: 13.5 }}>
          لا تستطيع المسح؟ اكتب هذا المفتاح يدوياً في التطبيق:
        </p>
        <p className="num" style={{ fontWeight: 600, wordBreak: 'break-all', marginBottom: 16 }}>
          {state.secret.replace(/(.{4})/g, '$1 ').trim()}
        </p>
        <Field id="code" label="رمز التحقق" hint="ستة أرقام من تطبيق المصادقة">
          <input {...fieldProps('code', { hint: true, required: true, ltr: true })} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        </Field>
        <button className="btn k" type="submit" disabled={pending}>
          {pending ? 'جارٍ التأكيد…' : 'تأكيد وتفعيل الحساب'}
        </button>
      </form>
    );
  }

  const errors = state?.step === 'password' ? state.errors : undefined;
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
      <Field id="password" label="كلمة المرور" hint="١٢ حرفاً على الأقل" error={errors?.password} required>
        <input {...fieldProps('password', { error: errors?.password, hint: true, required: true, ltr: true })} type="password" autoComplete="new-password" maxLength={200} />
      </Field>
      <Field id="confirm" label="أعد كتابة كلمة المرور" required>
        <input {...fieldProps('confirm', { required: true, ltr: true })} type="password" autoComplete="new-password" maxLength={200} />
      </Field>
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الحفظ…' : appCode ? 'التالي: تطبيق المصادقة' : 'حفظ والدخول'}
      </button>
    </form>
  );
}
