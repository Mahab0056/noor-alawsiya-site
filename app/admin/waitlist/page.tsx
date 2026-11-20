import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { waitlistNotifiedAction, waitlistRemoveAction } from '@/app/admin/waitlist/actions';
import { AdminShell } from '@/components/AdminShell';
import { CopyText } from '@/components/CopyText';
import { Icon } from '@/components/Icon';
import { countRequests } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { formatDate, formatDateTime } from '@/lib/format';
import { appOrigin } from '@/lib/mail';
import { listOpenCourses } from '@/lib/registration';
import { requireAdmin } from '@/lib/session';
import { AGE_BAND_LABEL, listWaitlist, purgeWaitlist, WAITLIST_KEEP_DAYS, waLink, waitlistMessage, type WaitEntry, type WaitGroup } from '@/lib/waitlist';
import { DEFAULT_ORIGIN } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'قائمة الانتظار', robots: { index: false, follow: false } };

export default function AdminWaitlistPage() {
  return (
    <Suspense fallback={null}>
      <Waitlist />
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

/** 07701234567 → 0770 123 4567, read left to right. */
const showPhone = (p: string) => `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}`;

const groupId = (g: WaitGroup) => (g.courseId === null ? 'any' : `c-${g.courseId}`);
const groupTitle = (g: WaitGroup) => g.course ?? 'أي دورة';

function GroupTag({ g, anyOpen }: { g: WaitGroup; anyOpen: boolean }) {
  if (g.courseId === null) return anyOpen ? <span className="tag ok">فيه دورة تقبل التسجيل</span> : <span className="tag warn">ماكو دورة مفتوحة</span>;
  if (g.accepting) return <span className="tag ok">تقبل التسجيل</span>;
  if (g.done) return <span className="tag">منتهية</span>;
  return <span className="tag warn">التسجيل مغلق</span>;
}

function EntryRow({ e, n, message }: { e: WaitEntry; n: number; message: string | null }) {
  const who = e.guardianName ?? 'بلا اسم';
  const link = message ? waLink(e.phone, message) : null;
  return (
    <li className={`qrow${e.notifiedAt ? ' off' : ''}`}>
      <span className="qn">{ar(n)}</span>
      <div>
        <b>
          <span className="num" dir="ltr">
            {showPhone(e.phone)}
          </span>
        </b>
        <div className="qmeta">
          <span>{who}</span>
          {e.ageBand ? <span className="mute">{AGE_BAND_LABEL[e.ageBand]}</span> : null}
          <span className="mute">من {formatDate(e.createdAt)}</span>
          {e.notifiedAt ? <span className="tag ok">بُلّغ {formatDateTime(e.notifiedAt)}</span> : <span className="tag y">ينتظر</span>}
        </div>
      </div>
      <div className="sp">
        {link ? (
          <a className="btn w sm" href={link} target="_blank" rel="noopener noreferrer" aria-label={`افتح واتساب برسالة جاهزة إلى ${who} (نافذة جديدة)`}>
            <Icon name="msg" size="s" />
            واتساب
          </a>
        ) : null}
        {e.notifiedAt ? null : (
          <form action={waitlistNotifiedAction}>
            <input type="hidden" name="id" value={e.id} />
            <button className="btn w sm" aria-label={`تم التبليغ: ${who}`}>
              تم التبليغ
            </button>
          </form>
        )}
        <form action={waitlistRemoveAction}>
          <input type="hidden" name="id" value={e.id} />
          <button className="btn no sm" aria-label={`احذف ${who} ويمسح الرقم`}>
            احذف
          </button>
        </form>
      </div>
    </li>
  );
}

async function Waitlist() {
  const admin = await requireAdmin();
  const db = await getDb();
  await purgeWaitlist(db); // retention: numbers told more than WAITLIST_KEEP_DAYS ago are blanked before anyone sees the list
  const [groups, counts, open] = await Promise.all([listWaitlist(db), countRequests(db), listOpenCourses(db)]);
  const anyOpen = open.length > 0;
  const origin = siteOrigin();
  const waiting = groups.reduce((s, g) => s + g.waiting, 0);
  const told = groups.reduce((s, g) => s + g.entries.length - g.waiting, 0);

  return (
    <AdminShell admin={admin} current="waitlist" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>قائمة الانتظار</h1>
          <p>
            أرقام أولياء الأمور الذين طلبوا «بلّغوني لما تنفتح دورة». ينتظرون: {ar(waiting)} · بُلّغوا: {ar(told)}.
          </p>
        </div>
      </div>
      <p className="alert info">
        الموقع لا يرسل شيئاً. زر «واتساب» يفتح محادثة برسالة جاهزة على جهازك، وأنت تضغط إرسال. بعدها اضغط «تم التبليغ». من يرد «إلغاء» اضغط «احذف»: يمسح رقمه.
        الرقم يُمسح وحده بعد {ar(WAITLIST_KEEP_DAYS)} يوماً من التبليغ (مقترح).
      </p>
      {groups.length === 0 ? (
        <div className="card">
          <p className="empty">القائمة فارغة.</p>
        </div>
      ) : null}
      {groups.map((g) => {
        const message = waitlistMessage(g, anyOpen, origin);
        const msgId = `${groupId(g)}-msg`;
        return (
          <section className="card wl-group" key={groupId(g)} id={groupId(g)} aria-labelledby={`${groupId(g)}-h`}>
            <div className="ch">
              <h2 id={`${groupId(g)}-h`}>{groupTitle(g)}</h2>
              <GroupTag g={g} anyOpen={anyOpen} />
              <span className="mute">
                ينتظرون {ar(g.waiting)} من {ar(g.entries.length)}
              </span>
            </div>
            <div className="wl-msg">
              {message ? (
                <>
                  <pre id={msgId}>{message}</pre>
                  <div className="acts">
                    <CopyText text={message} label="انسخ رسالة الواتساب" describedBy={msgId} />
                  </div>
                </>
              ) : (
                <p className="mute">
                  {g.courseId === null ? 'ماكو دورة تقبل التسجيل هسه.' : 'هالدورة بعدها مسدودة.'} لما تنفتح من{' '}
                  {admin.role === 'super_admin' ? <Link href="/admin/courses">«الدورات»</Link> : '«الدورات»'} تطلع هنا رسالة جاهزة.
                </p>
              )}
            </div>
            <ol className="qlist">
              {g.entries.map((e, i) => (
                <EntryRow key={e.id} e={e} n={i + 1} message={message} />
              ))}
            </ol>
          </section>
        );
      })}
    </AdminShell>
  );
}
