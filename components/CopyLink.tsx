'use client';

import { useState } from 'react';

/** The link in a read-only box (select it by hand if the clipboard is blocked) and a «نسخ» button. */
export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setDone('ok');
    } catch {
      setDone('fail');
    }
  };
  return (
    <div className="cq-copy">
      <label className="lbl" htmlFor="made-url">
        الرابط
      </label>
      <div className="cq-copy-row">
        <input id="made-url" className="inp ltr" dir="ltr" readOnly value={url} onFocus={(ev) => ev.currentTarget.select()} />
        <button type="button" className="btn w" onClick={copy}>
          نسخ
        </button>
      </div>
      <span className="hint" role="status">
        {done === 'ok' ? 'نُسخ الرابط.' : done === 'fail' ? 'لم يسمح المتصفح بالنسخ. حدّد الرابط وانسخه يدوياً.' : ''}
      </span>
    </div>
  );
}
