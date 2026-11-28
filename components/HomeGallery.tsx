import { connection } from 'next/server';
import { ar } from '@/lib/data';
import { getDb } from '@/lib/db';
import { listGallery } from '@/lib/gallery';

/** «معرض الصور» on the home page. Read per request, and absent while the gallery is empty. */
export async function HomeGallery() {
  await connection();
  const images = await listGallery(await getDb());
  if (images.length === 0) return null;
  return (
    <section className="sec" style={{ paddingBottom: 0 }}>
      <div className="wrap">
        <div className="sec-h">
          <div>
            <p className="eye">معرض الصور</p>
            <h2>من حلقات المدرسة ومحافلها</h2>
          </div>
        </div>
        <ul className="gal">
          {images.map((g, i) => (
            <li key={g.id}>
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- served from the database by /gallery/[id], already sized */}
                <img src={`/gallery/${g.id}`} alt={g.caption || `صورة ${ar(i + 1)} من معرض المدرسة`} width={g.width} height={g.height} loading="lazy" decoding="async" />
                {g.caption ? <figcaption>{g.caption}</figcaption> : null}
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
