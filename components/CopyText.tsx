'use client';

import { useState } from 'react';

/** «انسخ رسالة الواتساب». The text is also on screen, so it can be selected by hand if the clipboard is blocked. */
export function CopyText({ text, label, describedBy }: { text: string; label: string; describedBy?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <>
      <button
        type="button"
        className="btn w sm"
        aria-describedby={describedBy}
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => setState('copied'),
            () => setState('failed'),
          );
        }}
      >
        {label}
      </button>
      <span role="status" className="mute">
        {state === 'copied' ? 'انسخت.' : state === 'failed' ? 'ما انسخت؛ ظلّل النص وانسخه بيدك.' : ''}
      </span>
    </>
  );
}
