import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { reviewAction } from '@/app/admin/actions';
import { AdminShell } from '@/components/AdminShell';
import { Icon } from '@/components/Icon';
import { NotifyWhatsAppLink } from '@/components/NotifyWhatsApp';
import { countRequests, getRequest, lastNotifiedAt, listCourseFilterOptions, listRequests, oldestPendingAt, type RequestDetail } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { formatDate, formatDateTime, STATUS_LABEL, STATUS_TAG } from '@/lib/format';
import { appOrigin } from '@/lib/mail';
import { defaultSort, parseQueueView, pendingSummary, queueHref, STATUSES, WAIT_TAG, waitBadgeText, waitLevel } from '@/lib/queue';
import type { RegistrationStatus } from '@/lib/registration';
import { requireAdmin } from '@/lib/session';
import { decisionMessage, DEFAULT_ORIGIN, notifyRecipient, whatsappLink } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'طلبات التسجيل', robots: { index: false, follow: false } };

export default function AdminPage({ searchParams }: PageProps<'/admin'>) {
  return (
    <Suspense fallback={null}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

const siteOrigin = () => {
  try {
    return appOrigin();
  } catch {
    return DEFAULT_ORIGIN;
  }
};

/** «إبلاغ عبر واتساب»: shown once a request is accepted or rejected. Opens a prepared chat on the admin's own phone. */
function NotifyBox({ request, notifiedAt }: { request: RequestDetail; notifiedAt: Date | null }) {
  if (request.status === 'pending') return null;
  const { to, number } = notifyRecipient(request);
  const who = to === 'guardian' ? 'ولي الأمر' : 'الطالب';
  return (
    <div className="notify">
      {number ? (
        <>
          <NotifyWhatsAppLink href={whatsappLink(number, decisionMessage(request.status, request.course, siteOrigin()))} requestId={request.id} describedBy="notify-hint">
            <Icon name="msg" size="s" />
            إبلاغ {who} عبر واتساب
            <span className="vh"> (يفتح واتساب في نافذة جديدة)</span>
          </NotifyWhatsAppLink>
          <p className="hint" id="notify-hint">
            يفتح واتساب على جهازك برسالة جاهزة فيها اسم الدورة والنتيجة ورابط الحساب. لا يُرسل شيء إلا إذا ضغطت إرسال.
          </p>
        </>
      ) : (
        <p className="hint">رقم هاتف {who} المسجّل لا يصلح لواتساب، فلا يمكن تجهيز الرسالة.</p>
      )}
      {notifiedAt ? (
        <p className="hint done">
          <Icon name="check" size="s" />
          فُتحت رسالة واتساب لهذا القرار في {formatDateTime(notifiedAt)}.
        </p>
      ) : null}
    </div>
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

/** How long a pending request has waited: neutral, amber from 24 h, red from 48 h (lib/queue.ts). */
function WaitTag({ createdAt, now }: { createdAt: Date; now: Date }) {
  return (
    <span className={`tag ${WAIT_TAG[waitLevel(createdAt, now)]}`}>
      <i />
      {waitBadgeText(createdAt, now)}
    </span>
  );
}

/** A request made from «حسابي» by a student who already has an account: same student row, no new personal data. */
function ExistingTag() {
  return <span className="tag known">طالب مسجّل</span>;
}

async function Requests({ searchParams }: Pick<PageProps<'/admin'>, 'searchParams'>) {
  const admin = await requireAdmin();
  const now = new Date(); // after requireAdmin: this render is per request, so the waiting times are current
  const params = await searchParams;
  const openId = typeof params.id === 'string' && /^\d{1,15}$/.test(params.id) ? Number(params.id) : null;

  const db = await getDb();
  const courses = await listCourseFilterOptions(db);
  const asked = parseQueueView(params);
  // An unknown course id shows every course rather than an empty list that looks like «no requests».
  const view = { ...asked, courseId: courses.some((c) => c.id === asked.courseId) ? asked.courseId : null };
  const status = view.status;
  const [counts, tabCounts, oldest, rows, open, notifiedAt] = await Promise.all([
    countRequests(db),
    view.courseId ? countRequests(db, view.courseId) : null,
    oldestPendingAt(db),
    listRequests(db, status, { courseId: view.courseId, sort: view.sort }),
    openId ? getRequest(db, openId) : null,
    openId ? lastNotifiedAt(db, openId) : null,
  ]);
  const inTabs = tabCounts ?? counts;
  const oldestLevel = oldest ? waitLevel(oldest, now) : 'fresh';

  return (
    <AdminShell admin={admin} current="requests" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>طلبات التسجيل</h1>
          <p className="queue-sum">
            {pendingSummary(counts.pending, oldest, now)}
            {oldestLevel !== 'fresh' ? (
              <span className={`tag ${WAIT_TAG[oldestLevel]}`}>
                <i />
                {oldestLevel === 'overdue' ? 'تجاوز ٤٨ ساعة' : 'تجاوز ٢٤ ساعة'}
              </span>
            ) : null}
          </p>
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
              <Link key={s} href={queueHref({ status: s, courseId: view.courseId, sort: defaultSort(s) })} className={s === status ? 'on' : undefined} aria-current={s === status ? 'page' : undefined}>
                {STATUS_LABEL[s]} <b>{ar(inTabs[s])}</b>
              </Link>
            ))}
          </nav>
          {/* A plain GET form: works without JavaScript, and the address can be bookmarked or shared between the admins. */}
          <form className="filt" action="/admin" method="get" aria-label="تصفية الطلبات">
            <input type="hidden" name="status" value={status} />
            <div className="field">
              <label htmlFor="f-course">الدورة</label>
              <select className="inp" id="f-course" name="course" defaultValue={view.courseId ? String(view.courseId) : ''}>
                <option value="">كل الدورات</option>
                {courses.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.pending > 0 ? `${c.name} (${ar(c.pending)} قيد المراجعة)` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-sort">الترتيب</label>
              <select className="inp" id="f-sort" name="sort" defaultValue={view.sort}>
                <option value="oldest">الأقدم أولاً</option>
                <option value="newest">الأحدث أولاً</option>
              </select>
            </div>
            <button className="btn w" type="submit">
              عرض
            </button>
          </form>
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
                      {r.status === 'pending' ? formatDateTime(r.createdAt) : formatDate(r.createdAt)}
                    </td>
                    <td role="cell">{r.status === 'pending' ? <WaitTag createdAt={r.createdAt} now={now} /> : <StatusTag status={r.status} />}</td>
                    <td role="cell">
                      <div className="tacts">
                        <Link className="btn w sm" href={`${queueHref(view, { id: r.id })}#request`} aria-label={`عرض طلب ${r.studentName}`}>
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
                  {open.status === 'pending' ? (
                    <>
                      {formatDateTime(open.createdAt)} <WaitTag createdAt={open.createdAt} now={now} />
                    </>
                  ) : (
                    formatDate(open.createdAt)
                  )}
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
            <NotifyBox request={open} notifiedAt={notifiedAt} />
            <form className="ft" action={reviewAction}>
              <input type="hidden" name="id" value={open.id} />
              <input type="hidden" name="from" value={status} />
              {view.courseId ? <input type="hidden" name="course" value={view.courseId} /> : null}
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
