import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { reviewAction } from '@/app/admin/actions';
import { AdminShell } from '@/components/AdminShell';
import { Icon } from '@/components/Icon';
import { countRequests, getRequest, listRequests } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { formatDate, STATUS_LABEL, STATUS_TAG } from '@/lib/format';
import type { RegistrationStatus } from '@/lib/registration';
import { requireAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'طلبات التسجيل', robots: { index: false, follow: false } };

const STATUSES: RegistrationStatus[] = ['pending', 'accepted', 'rejected'];

export default function AdminPage({ searchParams }: PageProps<'/admin'>) {
  return (
    <Suspense fallback={null}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

function StatusTag({ status }: { status: RegistrationStatus }) {
  return (
    <span className={`tag ${STATUS_TAG[status]}`}>
      <i />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A request made from «حسابي» by a student who already has an account: same student row, no new personal data. */
function ExistingTag() {
  return <span className="tag known">طالب مسجّل</span>;
}

async function Requests({ searchParams }: Pick<PageProps<'/admin'>, 'searchParams'>) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const status = STATUSES.find((s) => s === params.status) ?? 'pending';
  const openId = typeof params.id === 'string' && /^\d{1,15}$/.test(params.id) ? Number(params.id) : null;

  const db = await getDb();
  const [counts, rows, open] = await Promise.all([countRequests(db), listRequests(db, status), openId ? getRequest(db, openId) : null]);

  return (
    <AdminShell admin={admin} current="requests" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>طلبات التسجيل</h1>
          <p>{counts.pending > 0 ? `${ar(counts.pending)} بانتظار مراجعتك` : 'لا طلبات بانتظار المراجعة'}</p>
        </div>
      </div>

      <div className="kpis">
        {STATUSES.map((s) => (
          <div className={`card kpi${s === 'pending' ? ' hi' : ''}`} key={s}>
            <div className="t">
              <span className="ic">
                <Icon name={s === 'pending' ? 'inbox' : s === 'accepted' ? 'users' : 'flag'} size="s" />
              </span>
              {STATUS_LABEL[s]}
            </div>
            <b>{ar(counts[s])}</b>
          </div>
        ))}
      </div>

      <div className="row">
        <div className="card">
          <nav className="tabs" aria-label="حالة الطلب">
            {STATUSES.map((s) => (
              <Link key={s} href={`/admin?status=${s}`} className={s === status ? 'on' : undefined} aria-current={s === status ? 'page' : undefined}>
                {STATUS_LABEL[s]} <b>{ar(counts[s])}</b>
              </Link>
            ))}
          </nav>
          {rows.length === 0 ? (
            <p className="empty">لا توجد طلبات في هذه القائمة.</p>
          ) : (
            <table className="st" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader">الطالب</th>
                  <th role="columnheader">الدورة</th>
                  <th role="columnheader" className="hm">
                    تاريخ الطلب
                  </th>
                  <th role="columnheader">الحالة</th>
                  <th role="columnheader">
                    <span className="vh">إجراء</span>
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((r) => (
                  <tr role="row" key={r.id} className={r.id === open?.id ? 'sel' : undefined}>
                    <td role="cell">
                      <div className="who">
                        <span className="av" aria-hidden="true">
                          {r.studentName[0]}
                        </span>
                        <span>
                          <b>{r.studentName}</b>
                          <small>
                            مواليد {ar(r.birthYear)}
                            {r.hasGuardian ? ' · ولي الأمر موافق' : ''}
                          </small>
                          {r.existingStudent ? <ExistingTag /> : null}
                        </span>
                      </div>
                    </td>
                    <td role="cell">{r.course}</td>
                    <td role="cell" className="hm mute">
                      {formatDate(r.createdAt)}
                    </td>
                    <td role="cell">
                      <StatusTag status={r.status} />
                    </td>
                    <td role="cell">
                      <div className="tacts">
                        <Link className="btn w sm" href={`/admin?status=${status}&id=${r.id}#request`} aria-label={`عرض طلب ${r.studentName}`}>
                          عرض
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {open ? (
          <section className="card drawer" id="request" aria-label={`طلب ${open.studentName}`}>
            <div className="hd">
              <span className="av y lg" aria-hidden="true">
                {open.studentName[0]}
              </span>
              <div>
                <b>{open.studentName}</b>
                <small>
                  طلب رقم <span className="num">#{String(open.id).padStart(4, '0')}</span> · {open.course}
                </small>
                {open.existingStudent ? <ExistingTag /> : null}
              </div>
              <StatusTag status={open.status} />
            </div>
            <dl>
              <div>
                <dt>سنة الميلاد ورقم الهاتف</dt>
                <dd>
                  {ar(open.birthYear)} · <span className="num">{open.phone}</span>
                </dd>
              </div>
              {open.guardianName ? (
                <div>
                  <dt>ولي الأمر (وافق على التسجيل)</dt>
                  <dd>
                    {open.guardianName} · <span className="num">{open.guardianPhone}</span>
                  </dd>
                </div>
              ) : null}
              {open.requestConsentAt ? (
                <div>
                  <dt>موافقة ولي الأمر على هذا الطلب</dt>
                  <dd>نعم، في {formatDate(open.requestConsentAt)}</dd>
                </div>
              ) : null}
              {open.studentNote ? (
                <div>
                  <dt>ملاحظة الطالب</dt>
                  <dd className="pre">{open.studentNote}</dd>
                </div>
              ) : null}
              <div>
                <dt>الدورة والأستاذ</dt>
                <dd>
                  {open.course} · {open.teacher}
                </dd>
              </div>
              {open.answers.map((a, i) => (
                <div key={i}>
                  <dt>{a.label}</dt>
                  <dd>{a.answer}</dd>
                </div>
              ))}
              <div>
                <dt>تاريخ الطلب</dt>
                <dd>
                  {formatDate(open.createdAt)}
                  {open.reviewedAt ? ` · رُوجع في ${formatDate(open.reviewedAt)}` : ''}
                </dd>
              </div>
            </dl>
            {params.conflict === '1' ? (
              <p className="alert bad" role="alert" style={{ margin: '12px 22px 0' }}>
                لم يُحفظ القبول: لهذا الطالب طلب آخر قيد المراجعة أو مقبول للدورة نفسها. راجع الطلب الأحدث بدلاً منه.
              </p>
            ) : null}
            {params.done === '1' ? (
              <p className="alert ok" role="status" style={{ margin: '12px 22px 0' }}>
                حُفظ القرار، وسيراه الطالب في حسابه.
              </p>
            ) : null}
            <form className="ft" action={reviewAction}>
              <input type="hidden" name="id" value={open.id} />
              <input type="hidden" name="from" value={status} />
              <label className="lbl" htmlFor="note">
                ملاحظة للطالب (اختياري)
              </label>
              <textarea className="inp" id="note" name="note" maxLength={500} defaultValue={open.adminNote ?? ''} />
              <div className="two">
                <button className="btn ok" type="submit" name="decision" value="accepted" >
                  <Icon name="check" size="s" />
                  {open.status === 'accepted' ? 'حفظ الملاحظة' : 'قبول الطلب'}
                </button>
                <button className="btn no" type="submit" name="decision" value="rejected" >
                  {open.status === 'rejected' ? 'حفظ الملاحظة' : 'رفض الطلب'}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <div className="card empty">اختر طلباً من القائمة لعرض تفاصيله وإجابات الاستبيان.</div>
        )}
      </div>
    </AdminShell>
  );
}
