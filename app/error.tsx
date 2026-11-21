'use client';

import Link from 'next/link';

/**
 * Any unexpected error inside a page (for example the database not answering). Arabic, with a retry, instead of Next's
 * English default. Nothing from the error is shown: in production it only carries a digest for the server logs.
 * No import from SiteChrome here: it reads the database, and this file runs in the browser.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <main className="auth" id="main">
      <div className="card box">
        <h1>تعذّر عرض الصفحة الآن</h1>
        <p className="sub">حدث خطأ غير متوقع من جهتنا. حاول مرة أخرى بعد قليل، وإن تكرر فراسل إدارة المدرسة على واتساب.</p>
        <button className="btn k" type="button" onClick={() => retry()}>
          حاول مرة أخرى
        </button>
        <p className="alt">
          <Link href="/">العودة إلى الرئيسية</Link>
          {digest ? (
            <>
              {' · '}رمز الخطأ: <span dir="ltr" className="num">{digest}</span>
            </>
          ) : null}
        </p>
      </div>
    </main>
  );
}
