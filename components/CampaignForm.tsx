'use client';

import { useActionState, useState } from 'react';
import { addCampaignAction, type CampaignState } from '@/app/admin/campaigns/actions';
import { campaignUrl, cleanName, NAME_MAX, NAME_MAX_AR, nameError, TARGET_LABEL, TARGETS, type CampaignTarget } from '@/lib/campaign-links';
import { Field, fieldProps } from './Field';

type Course = { id: number; name: string; accepting: boolean };

const TARGET_HINT: Record<CampaignTarget, string> = {
  register: 'الأفضل للعدّ: يفتح نموذج التسجيل مباشرة.',
  course: 'نموذج التسجيل والدورة مختارة فيه.',
  home: 'للتعريف بالمدرسة. العدّ يكون عند فتح نموذج التسجيل.',
};

/** «رابط جديد». The link is previewed while typing with the same rules the server applies (lib/campaign-links.ts). */
export function CampaignForm({ courses }: { courses: Course[] }) {
  const [target, setTarget] = useState<CampaignTarget>('register');
  const [course, setCourse] = useState('');
  const [name, setName] = useState('');
  const [state, action, pending] = useActionState<CampaignState, FormData>(addCampaignAction, undefined);
  const e = state?.errors ?? {};
  const clean = cleanName(name);
  const preview = clean !== '' && !nameError(clean) && (target !== 'course' || course !== '') ? campaignUrl(target, clean, Number(course)) : null;

  return (
    <form action={action} noValidate>
      {state?.error ? (
        <p className="alert bad" role="alert">
          {state.error}
        </p>
      ) : null}
      <fieldset className="field" aria-describedby={e.target ? 'target-err' : undefined}>
        <legend className="lbl">الصفحة التي يفتحها الرابط</legend>
        <div className="opts">
          {TARGETS.map((t) => (
            <label className="opt cq-opt" key={t}>
              <input type="radio" name="target" value={t} checked={target === t} onChange={() => setTarget(t)} />
              <span>
                {TARGET_LABEL[t]}
                <small>{TARGET_HINT[t]}</small>
              </span>
            </label>
          ))}
        </div>
        {e.target ? (
          <span className="err" id="target-err">
            {e.target}
          </span>
        ) : null}
      </fieldset>
      {target === 'course' ? (
        <Field id="course" label="الدورة" required error={e.course} hint={courses.length === 0 ? 'لا دورات قائمة. أضف دورة من «الدورات» أولاً.' : 'الدورات المنتهية لا تظهر هنا.'}>
          <select {...fieldProps('course', { required: true, error: e.course, hint: true })} value={course} onChange={(ev) => setCourse(ev.target.value)}>
            <option value="">اختر الدورة</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.accepting ? c.name : `${c.name} (التسجيل مغلق)`}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field
        id="name"
        label="اسم المصدر"
        required
        error={e.name}
        hint={
          <>
            حروف إنجليزية صغيرة وأرقام وشرطة، حتى {NAME_MAX_AR} حرفاً. مثل: <bdi className="ltr-name">masjid-board</bdi> أو <bdi className="ltr-name">ig-bio</bdi> أو{' '}
            <bdi className="ltr-name">poster-1</bdi>.
          </>
        }
      >
        <input
          {...fieldProps('name', { required: true, error: e.name, hint: true, ltr: true })}
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          maxLength={NAME_MAX + 4}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          dir="ltr"
        />
      </Field>
      <div className="cq-preview" aria-live="polite">
        <span className="lbl">الرابط</span>
        {preview ? <bdi className="cq-url">{preview}</bdi> : <span className="mute">يظهر هنا حين يكتمل الاسم.</span>}
      </div>
      <button className="btn k" type="submit" disabled={pending}>
        {pending ? 'جارٍ الصنع…' : 'اصنع الرابط ورمز QR'}
      </button>
    </form>
  );
}
