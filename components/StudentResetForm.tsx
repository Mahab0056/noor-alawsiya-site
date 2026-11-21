'use client';

import { useActionState } from 'react';
import { studentResetAction, type StudentResetState } from '@/app/admin/actions';

/**
 * «نسي الطالب كلمة المرور؟» in the request drawer. Closed by default (a <details>), so the button is a second, deliberate
 * step. The temporary password is shown once, here, with a prepared WhatsApp chat to the number on file.
 */
export function StudentResetForm({ requestId }: { requestId: number }) {
  const [state, action, pending] = useActionState<StudentResetState, FormData>(studentResetAction, undefined);
  const who = state && 'to' in state && state.to === 'guardian' ? 'ولي الأمر' : 'الطالب';
  return (
    <details className="reset">
      <summary>نسي الطالب كلمة المرور؟</summary>
      {state && 'password' in state ? (
        <div className="done" role="status">
          <p>
            كلمة المرور المؤقتة (تظهر هذه المرة فقط):{' '}
            <b dir="ltr" className="num pw">
              {state.password}
            </b>
          </p>
          <p className="hint">الكلمة السابقة توقفت، وخرج الطالب من كل أجهزته.</p>
          {state.link ? (
            <a className="btn w" href={state.link} target="_blank" rel="noopener noreferrer">
              أرسلها إلى {who} عبر واتساب<span className="vh"> (يفتح واتساب في نافذة جديدة)</span>
            </a>
          ) : (
            <p className="hint">رقم هاتف {who} المسجّل لا يصلح لواتساب: أعطه الكلمة بنفسك.</p>
          )}
        </div>
      ) : (
        <form action={action}>
          <input type="hidden" name="id" value={requestId} />
          <p className="hint">
            تُنشأ كلمة مرور مؤقتة جديدة وتتوقف القديمة فوراً. ترسلها أنت عبر واتساب إلى الرقم المسجّل في الطلب (رقم ولي الأمر لمن هو دون ١٨ سنة)، ولا تُرسل إلى أي رقم آخر.
          </p>
          {state && 'error' in state ? (
            <p className="alert bad" role="alert">
              {state.error}
            </p>
          ) : null}
          <button className="btn w" type="submit" disabled={pending}>
            {pending ? 'جارٍ الإنشاء…' : 'أنشئ كلمة مرور مؤقتة'}
          </button>
        </form>
      )}
    </details>
  );
}
