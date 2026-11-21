import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { CampaignForm } from '@/components/CampaignForm';
import { CopyLink } from '@/components/CopyLink';
import { countRequests } from '@/lib/admin';
import { TARGET_LABEL } from '@/lib/campaign-links';
import { pngScale, qrMatrix, qrPath, qrSide } from '@/lib/campaign-qr';
import { campaignCourses, getCampaignLink, listCampaignLinks, type CampaignLink } from '@/lib/campaigns';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { requireSuperAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'روابط الحملات', robots: { index: false, follow: false } };

export default function AdminCampaignsPage({ searchParams }: PageProps<'/admin/campaigns'>) {
  return (
    <Suspense fallback={null}>
      <Campaigns searchParams={searchParams} />
    </Suspense>
  );
}

const qrHref = (l: CampaignLink, format: 'png' | 'svg') => `/admin/campaigns/qr?id=${l.id}&format=${format}`;

function Where({ l }: { l: CampaignLink }) {
  if (l.target !== 'course') return <span className="mute">{TARGET_LABEL[l.target]}</span>;
  return (
    <>
      <span className="mute">{l.courseName}</span>
      {l.courseAccepting ? null : <span className="tag warn">التسجيل في الدورة مغلق</span>}
    </>
  );
}

/** The QR as an inline SVG (no image request, nothing outside the page). Same matrix as the downloads. */
function QrPreview({ url, label }: { url: string; label: string }) {
  const m = qrMatrix(url);
  const s = qrSide(m);
  return (
    <svg className="cq-img" viewBox={`0 0 ${s} ${s}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={s} height={s} fill="#fff" />
      <path fill="#000" d={qrPath(m)} />
    </svg>
  );
}

function Made({ l }: { l: CampaignLink }) {
  const m = qrMatrix(l.url);
  const px = qrSide(m) * pngScale(m);
  return (
    <section className="card cq" id="made" aria-labelledby="made-h" tabIndex={-1}>
      <div className="ch">
        <h2 id="made-h">
          الرابط <bdi className="ltr-name">{l.name}</bdi>
        </h2>
      </div>
      <div className="cq-body">
        <QrPreview url={l.url} label={`رمز QR للرابط ${l.url}`} />
        <div className="cq-side">
          <p className="cq-where">
            يفتح: <Where l={l} />
          </p>
          {l.target === 'course' && !l.courseAccepting ? (
            <p className="alert info">
              التسجيل في هذه الدورة مغلق الآن، فمن يفتح الرابط لن يجدها في نموذج التسجيل. افتح التسجيل فيها من «الدورات» قبل نشر الملصق.
            </p>
          ) : null}
          <CopyLink url={l.url} />
          <div className="cq-dl">
            <a className="btn k" href={qrHref(l, 'png')} download>
              تنزيل QR بصيغة PNG
            </a>
            <a className="btn w" href={qrHref(l, 'svg')} download>
              تنزيل QR بصيغة SVG
            </a>
          </div>
          <p className="hint">
            PNG: صورة {ar(px)} × {ar(px)} بكسل لإنستغرام والطباعة السريعة. SVG: للمطبعة، يكبر بلا تشويش. اترك حول الرمز هامشاً أبيض كما هو، وجرّبه بكاميرا الهاتف قبل الطباعة.
          </p>
        </div>
      </div>
    </section>
  );
}

async function Campaigns({ searchParams }: Pick<PageProps<'/admin/campaigns'>, 'searchParams'>) {
  const admin = await requireSuperAdmin();
  const db = await getDb();
  const params = await searchParams;
  const showId = Number(typeof params.show === 'string' ? params.show : NaN);
  const [links, courses, counts, shown] = await Promise.all([listCampaignLinks(db), campaignCourses(db), countRequests(db), getCampaignLink(db, showId)]);

  return (
    <AdminShell admin={admin} current="campaigns" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>روابط الحملات</h1>
          <p>
            رابط خاص لكل ملصق أو لوحة مسجد أو منشور، مع رمز QR للطباعة. في آخر الرابط اسم المصدر فقط (<bdi className="ltr-name">?from=</bdi>)، ولا يُحفظ شيء عن الزائر.
          </p>
        </div>
      </div>
      {shown ? <Made l={shown} /> : null}
      <div className="row">
        <div className="card">
          <div className="ch">
            <h2>الروابط المصنوعة</h2>
            <span className="tag">{ar(links.length)}</span>
          </div>
          {/* TODO(funnel-counts): requests per link, once the sign-up counters are on this base and count these names (lib/campaigns.ts). */}
          <p className="cq-todo">
            <span className="tag warn">لاحقاً</span> عدد الطلبات لكل رابط يظهر هنا بعد دمج عدّاد صفحة التسجيل. لم يُدمج بعد، فلا أرقام الآن.
          </p>
          {links.length === 0 ? <p className="empty">لا روابط بعد. اصنع أول رابط من النموذج المجاور.</p> : null}
          <ol className="qlist">
            {links.map((l) => (
              <li className={`qrow cq-row${shown?.id === l.id ? ' sel' : ''}`} key={l.id}>
                <div>
                  <b>
                    <bdi className="ltr-name">{l.name}</bdi>
                  </b>
                  <div className="qmeta">
                    <Where l={l} />
                    <span className="mute">{formatDate(l.createdAt)}</span>
                    <span className="mute">الطلبات: غير متاح بعد</span>
                  </div>
                  <bdi className="cq-url">{l.url}</bdi>
                </div>
                <div className="sp">
                  <Link className="btn sm w" href={`/admin/campaigns?show=${l.id}#made`} aria-label={`عرض رمز QR للرابط ${l.name}`}>
                    عرض QR
                  </Link>
                  <a className="btn sm w" href={qrHref(l, 'png')} download aria-label={`تنزيل رمز QR للرابط ${l.name} بصيغة PNG`}>
                    PNG
                  </a>
                  <a className="btn sm w" href={qrHref(l, 'svg')} download aria-label={`تنزيل رمز QR للرابط ${l.name} بصيغة SVG`}>
                    SVG
                  </a>
                </div>
              </li>
            ))}
          </ol>
          <p className="qfoot mute">الرابط لا يُحذف ولا يتغير بعد صنعه، لأنه قد يكون مطبوعاً على ملصق.</p>
        </div>
        <div className="card q">
          <h2 className="qh">رابط جديد</h2>
          <CampaignForm courses={courses} />
        </div>
      </div>
    </AdminShell>
  );
}
