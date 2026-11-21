'use client';

import Link from 'next/link';
import './globals.css';

/** An error in the root layout itself. It replaces the whole document, so it sets its own <html lang dir> and title. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <title>تعذّر عرض الصفحة | مدرسة نور الأوصياء</title>
        <main className="auth" id="main" style={{ padding: 24 }}>
          <div className="card box">
            <h1>تعذّر عرض الصفحة الآن</h1>
            <p className="sub">حدث خطأ غير متوقع من جهتنا. حاول مرة أخرى بعد قليل.</p>
            <button className="btn k" type="button" onClick={() => retry()}>
              حاول مرة أخرى
            </button>
            <p className="alt">
              <Link href="/">العودة إلى الرئيسية</Link>
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
