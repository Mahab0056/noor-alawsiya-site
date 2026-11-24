import Link from 'next/link';
import { ar } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { DIRECT, FUNNEL_STEPS, OTHER, type FunnelStep, type FunnelSummary } from '@/lib/funnel';

/** What each counted step means, in the order a visitor goes through them. */
export const STEP_LABEL: Record<FunnelStep, string> = {
  view: 'فتح نموذج التسجيل',
  start: 'بدأ التعبئة',
  review: 'وصل إلى المراجعة',
  sent: 'ضغط «إرسال الطلب»',
  saved: 'حُفظ الطلب',
};
/** Column heads of the per-source table: one short word each, so six columns fit a phone. */
const SHORT: Record<FunnelStep, string> = { view: 'فتح', start: 'بدأ', review: 'راجع', sent: 'أرسل', saved: 'حُفظ' };

const dayDate = (day: string) => new Date(`${day}T12:00:00+03:00`);

export function SourceName({ source }: { source: string }) {
  if (source === DIRECT) return <span>بلا رابط</span>;
  if (source === OTHER) return <span>مصدر آخر</span>;
  return <bdi className="ltr-name">{source}</bdi>;
}

/**
 * «صفحة التسجيل: آخر ٧ أيام» on /admin (FUNNEL_COUNTS on). Daily totals only, from funnel_daily: nothing about any
 * visitor. `linksPage`: the reader may open «روابط الحملات» (super admins), so the hint links to it.
 */
export function FunnelCard({ summary, linksPage }: { summary: FunnelSummary; linksPage: boolean }) {
  const { totals, sources } = summary;
  return (
    <section className="card fn" aria-labelledby="fn-h">
      <div className="ch">
        <h2 id="fn-h">صفحة التسجيل: آخر {ar(summary.days)} أيام</h2>
        <span className="mute fn-range">
          {formatDate(dayDate(summary.from))} – {formatDate(dayDate(summary.to))}
        </span>
      </div>
      <ol className="fn-steps">
        {FUNNEL_STEPS.map((s) => (
          <li key={s}>
            <span>{STEP_LABEL[s]}</span>
            <b>{ar(totals[s])}</b>
          </li>
        ))}
      </ol>
      {sources.length === 0 ? (
        <p className="empty">لا أرقام في هذه الأيام بعد.</p>
      ) : (
        <table className="fn-src">
          <caption className="vh">حسب المصدر</caption>
          <thead>
            <tr>
              <th scope="col">المصدر</th>
              {FUNNEL_STEPS.map((s) => (
                <th scope="col" key={s}>
                  <abbr title={STEP_LABEL[s]}>{SHORT[s]}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map((r) => (
              <tr key={r.source}>
                <th scope="row">
                  <SourceName source={r.source} />
                </th>
                {FUNNEL_STEPS.map((s) => (
                  <td key={s}>{ar(r.counts[s])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint fn-note">
        أعداد يومية فقط: لا كوكيز، ولا عنوان اتصال، ولا أي شيء عن الزائر. «بلا رابط»: فتح الصفحة دون رابط حملة. «مصدر آخر»: رابط باسم ليس من روابط الحملات.
        {linksPage ? (
          <>
            {' '}
            لكل ملصق أو منشور رابط خاص من <Link href="/admin/campaigns">روابط الحملات</Link> حتى يُعدّ وحده.
          </>
        ) : null}
      </p>
    </section>
  );
}
