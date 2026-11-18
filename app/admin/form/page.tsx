import type { Metadata } from 'next';
import { Suspense } from 'react';
import { moveQuestionAction, toggleQuestionAction } from '@/app/admin/actions';
import { AdminShell } from '@/components/AdminShell';
import { QuestionForm } from '@/components/QuestionForm';
import { countRequests } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { listQuestions, NO, YES, type FormQuestion, type QuestionKind } from '@/lib/registration';
import { requireAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'استبيان التسجيل', robots: { index: false, follow: false } };

const KIND_LABEL: Record<QuestionKind, string> = { single: 'إجابة واحدة', multi: 'أكثر من إجابة', yes_no: 'نعم / لا', text: 'إجابة مكتوبة' };

export default function AdminFormPage() {
  return (
    <Suspense fallback={null}>
      <Builder />
    </Suspense>
  );
}

const optionsOf = (q: FormQuestion) => (q.kind === 'yes_no' ? [YES, NO] : q.kind === 'text' ? [] : q.options);

async function Builder() {
  const admin = await requireAdmin();
  const db = await getDb();
  const [questions, counts] = await Promise.all([listQuestions(db, { includeInactive: true }), countRequests(db)]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const conditions = questions.filter((q) => q.active).flatMap((q) => optionsOf(q).map((o) => ({ value: `${q.id}|${o}`, label: `إذا كانت إجابة «${q.label}» هي «${o}»` })));

  return (
    <AdminShell admin={admin} current="form" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>استبيان التسجيل</h1>
          <p>الأسئلة التي يجيب عنها الطالب عند التسجيل، بالترتيب الذي تظهر به.</p>
        </div>
      </div>
      <div className="row">
        <div className="card">
          <div className="ch">
            <h2>الأسئلة الحالية</h2>
          </div>
          {questions.length === 0 ? <p className="empty">لا توجد أسئلة بعد. أضف أول سؤال من النموذج المجاور.</p> : null}
          <ol className="qlist">
            {questions.map((q, i) => {
              const cond = q.showIf ? byId.get(q.showIf.question_id) : null;
              // A conditional question only works while the question it depends on is active and comes before it.
              const broken = q.showIf && (!cond || !cond.active || questions.indexOf(cond) > i);
              return (
                <li className={`qrow${q.active ? '' : ' off'}`} key={q.id}>
                  <span className="qn">{ar(i + 1)}</span>
                  <div>
                    <b>{q.label}</b>
                    <div className="qmeta">
                      <span className="tag">{KIND_LABEL[q.kind]}</span>
                      {q.required ? <span className="tag y">مطلوب</span> : null}
                      {q.active ? null : <span className="tag bad">معطّل</span>}
                      {q.kind === 'single' || q.kind === 'multi' ? <span className="mute">{q.options.join('، ')}</span> : null}
                      {q.showIf ? (
                        <span className="mute">
                          يظهر إذا كانت إجابة «{cond?.label ?? 'سؤال غير موجود'}» هي «{q.showIf.equals}»
                        </span>
                      ) : null}
                      {broken ? <span className="tag warn">لن يظهر: السؤال المرتبط به معطّل أو يأتي بعده</span> : null}
                    </div>
                  </div>
                  <div className="sp">
                    <form action={moveQuestionAction}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className="btn w sm" name="direction" value="up" disabled={i === 0} aria-label={`نقل السؤال ${ar(i + 1)} إلى أعلى`}>
                        أعلى
                      </button>{' '}
                      <button className="btn w sm" name="direction" value="down" disabled={i === questions.length - 1} aria-label={`نقل السؤال ${ar(i + 1)} إلى أسفل`}>
                        أسفل
                      </button>
                    </form>
                    <form action={toggleQuestionAction}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className={`btn sm ${q.active ? 'no' : 'w'}`} name="active" value={q.active ? '0' : '1'}>
                        {q.active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="qfoot mute">السؤال لا يُحذف، بل يُعطَّل: لا يظهر للمسجّلين الجدد وتبقى إجاباته السابقة محفوظة.</p>
        </div>
        <div className="card q">
          <h2 className="qh">سؤال جديد</h2>
          <QuestionForm conditions={conditions} />
        </div>
      </div>
    </AdminShell>
  );
}
