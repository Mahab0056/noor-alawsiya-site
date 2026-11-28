import type { Metadata } from 'next';
import { Suspense } from 'react';
import { captionAction, deleteImageAction, moveImageAction } from '@/app/admin/gallery/actions';
import { AdminShell } from '@/components/AdminShell';
import { GalleryUpload } from '@/components/GalleryUpload';
import { countRequests } from '@/lib/admin';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { listGallery, MAX_IMAGES } from '@/lib/gallery';
import { requireAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'معرض الصور', robots: { index: false, follow: false } };

export default function AdminGalleryPage() {
  return (
    <Suspense fallback={null}>
      <Manager />
    </Suspense>
  );
}

async function Manager() {
  const admin = await requireAdmin();
  const db = await getDb();
  const [images, counts] = await Promise.all([listGallery(db), countRequests(db)]);

  return (
    <AdminShell admin={admin} current="gallery" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>معرض الصور</h1>
          <p>الصور التي تظهر في الصفحة الرئيسية، بالترتيب الذي تظهر به. {ar(images.length)} من {ar(MAX_IMAGES)}.</p>
        </div>
      </div>
      <div className="row">
        <div className="card">
          <div className="ch">
            <h2>الصور الحالية</h2>
          </div>
          {images.length === 0 ? <p className="empty">لا توجد صور بعد. القسم لا يظهر في الموقع حتى تضيف أول صورة.</p> : null}
          <ol className="qlist">
            {images.map((g, i) => (
              <li className="qrow grow" key={g.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served from the database by /gallery/[id], already sized */}
                <img className="gthumb" src={`/gallery/${g.id}`} alt={g.caption || `صورة ${ar(i + 1)}`} width={g.width} height={g.height} loading="lazy" />
                <form action={captionAction} className="gcap">
                  <input type="hidden" name="id" value={g.id} />
                  <label className="vh" htmlFor={`caption-${g.id}`}>
                    وصف الصورة {ar(i + 1)}
                  </label>
                  <input className="inp" id={`caption-${g.id}`} name="caption" defaultValue={g.caption} maxLength={140} placeholder="وصف الصورة" />
                  <button className="btn w sm">حفظ الوصف</button>
                </form>
                <div className="sp">
                  <form action={moveImageAction}>
                    <input type="hidden" name="id" value={g.id} />
                    <button className="btn w sm" name="direction" value="up" disabled={i === 0} aria-label={`تقديم الصورة ${ar(i + 1)}`}>
                      أعلى
                    </button>{' '}
                    <button className="btn w sm" name="direction" value="down" disabled={i === images.length - 1} aria-label={`تأخير الصورة ${ar(i + 1)}`}>
                      أسفل
                    </button>
                  </form>
                  <form action={deleteImageAction}>
                    <input type="hidden" name="id" value={g.id} />
                    <button className="btn sm no" aria-label={`حذف الصورة ${ar(i + 1)}`}>
                      حذف
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
          <p className="qfoot mute">الحذف نهائي: الصورة تختفي من الموقع فوراً. صور الطلاب القاصرين لا تُنشر إلا بموافقة ولي الأمر.</p>
        </div>
        <div className="card q">
          <h2 className="qh">صورة جديدة</h2>
          <GalleryUpload full={images.length >= MAX_IMAGES} />
        </div>
      </div>
    </AdminShell>
  );
}
