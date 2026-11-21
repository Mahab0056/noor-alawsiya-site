import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

// Before this, a wrong address showed Next's English «404: This page could not be found.» on an Arabic site.
export const metadata: Metadata = { title: 'الصفحة غير موجودة', robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="phead">
          <div className="wrap">
            <p className="eye">خطأ ٤٠٤</p>
            <h1>الصفحة غير موجودة</h1>
            <p>ربما تغيّر الرابط أو كُتب خطأً. هذه أهم صفحات الموقع:</p>
          </div>
        </section>
        <section className="sec" style={{ paddingTop: 32 }}>
          <div className="wrap" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link className="btn y" href="/">
              الرئيسية
            </Link>
            <Link className="btn o" href="/courses">
              الدورات والأساتذة
            </Link>
            <Link className="btn o" href="/register">
              التسجيل
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
