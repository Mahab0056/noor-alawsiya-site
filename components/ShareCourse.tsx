'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { courseUrl, whatsappShareHref } from '@/lib/share-links';

// The four line icons this needs, drawn here: importing <Icon> would ship the whole icon map (lib/icons.ts) to the
// browser, and the header's prefetch of /courses would then load it with every page.
const PATHS = {
  msg: 'M4 5h16v11H9l-5 4z',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  share: 'M15.5 5.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M15.5 18.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1',
} as const;
const Ic = ({ d }: { d: keyof typeof PATHS }) => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <path d={PATHS[d]} />
  </svg>
);

const noSubscribe = () => () => {};
const hasShareSheet = () => typeof navigator.share === 'function';
const serverUnknown = () => null;

type Props = {
  /** Course name, for labels, the WhatsApp message and the native share sheet. */
  name: string;
  /** The course page's slug; the links are built here so the page payload carries only the slug. */
  slug: string;
  /**
   * /courses rows: smaller buttons, no native-share button, and the course name comes from `describedBy` (the id of
   * the row's name) instead of hidden text, so twenty rows add as little as possible to the page.
   */
  compact?: boolean;
  describedBy?: string;
};

/**
 * «شارك بالواتساب» is a plain link (works with JavaScript off). «انسخ الرابط» copies the page link and says
 * «تم النسخ» in a live region. Where the browser has a share sheet (navigator.share), a third button opens it.
 * Nothing is counted or stored here: the only tag is `?from=wa` inside the WhatsApp message.
 */
export function ShareCourse({ name, slug, compact = false, describedBy }: Props) {
  // Copied and native-shared links carry no source tag: they can end up anywhere.
  const url = courseUrl(slug);
  const [copied, setCopied] = useState(false);
  // Known only in the browser (null on the server). Until then the button keeps its space hidden, so nothing moves.
  const canShare = useSyncExternalStore(noSubscribe, hasShareSheet, serverUnknown);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Older browsers or a page without clipboard permission: select and copy from a hidden field.
      const field = document.createElement('textarea');
      field.value = url;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      field.remove();
    }
    setCopied(ok);
    clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setCopied(false), 3000);
  }

  async function share() {
    try {
      await navigator.share({ title: name, text: name, url });
    } catch {
      // Closed by the person, or refused by the browser: nothing to do.
    }
  }

  const size = compact ? ' sm' : '';
  const about = describedBy ? null : <span className="vh">: {name}</span>;
  return (
    <div className={compact ? 'share c' : 'share'}>
      <a className={`btn ok${size}`} href={whatsappShareHref(name, slug)} target="_blank" rel="noopener noreferrer" aria-describedby={describedBy}>
        <Ic d="msg" />
        شارك بالواتساب{about}
      </a>
      <button type="button" className={`btn o${size}`} onClick={copy} aria-describedby={describedBy}>
        <Ic d={copied ? 'check' : 'link'} />
        {copied ? 'تم النسخ' : 'انسخ الرابط'}
        {about}
      </button>
      {compact ? null : (
        <button
          type="button"
          className="btn o"
          onClick={share}
          hidden={canShare === false}
          style={canShare ? undefined : { visibility: 'hidden' }}
        >
          <Ic d="share" />
          مشاركة<span className="vh"> بتطبيق آخر: {name}</span>
        </button>
      )}
      <span className="vh" role="status" aria-live="polite">
        {copied ? 'تم النسخ' : ''}
      </span>
    </div>
  );
}
