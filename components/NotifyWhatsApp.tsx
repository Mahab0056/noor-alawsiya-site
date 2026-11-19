'use client';

import type { ReactNode } from 'react';
import { notifiedAction } from '@/app/admin/actions';

/**
 * A plain link to wa.me, so it works like any link (keyboard, long-press, open in new tab).
 * Pressing it also records «notified» in the audit log by request id. The site sends nothing.
 */
export function NotifyWhatsAppLink({ href, requestId, describedBy, children }: { href: string; requestId: number; describedBy: string; children: ReactNode }) {
  return (
    <a
      className="btn w"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-describedby={describedBy}
      onClick={() => {
        void notifiedAction(requestId).catch(() => {}); // the chat still opens if the log call fails
      }}
    >
      {children}
    </a>
  );
}
