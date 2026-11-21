/**
 * Links for sharing a course and for «سجّل», with the `?from=` source tag the sign-up counters read (ig, fb, wa, qr …).
 * No imports, so the client share buttons can build them from a slug without pulling the course record into the
 * browser bundle or repeating long wa.me links in the page payload.
 */

export const ORIGIN = 'https://noor-alawsiya.com';

/** Only a short lowercase word is kept; anything else is dropped, never echoed into a link. */
export function cleanFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  return /^[a-z]{2,12}$/.test(v) ? v : undefined;
}

/** /register with the course preselected (by name, as RegisterForm expects) and the visitor's `from` kept. */
export function registerHref(courseName: string, from?: unknown): string {
  const q = new URLSearchParams({ course: courseName });
  const src = cleanFrom(from);
  if (src) q.set('from', src);
  return `/register?${q.toString()}`;
}

export const coursePath = (slug: string) => `/courses/${slug}`;

/** The link people share. `from` is the counters' source tag; only a short lowercase word is kept. */
export function courseUrl(slug: string, from?: string): string {
  const src = cleanFrom(from);
  return `${ORIGIN}${coursePath(slug)}${src ? `?from=${src}` : ''}`;
}

/** The message WhatsApp opens with: the course and the school, then the tagged link on its own line (so the card shows). */
export function shareText(courseName: string, slug: string): string {
  return `${courseName} · مدرسة نور الأوصياء\n${courseUrl(slug, 'wa')}`;
}

/**
 * wa.me with no number: WhatsApp asks which chat or group to send it to. Nothing is sent by the site.
 * Arabic letters stay as they are in the href (the browser percent-encodes them when the link is followed, so WhatsApp
 * gets the same URL); everything else is encoded. A percent-encoded Arabic letter is 6 bytes instead of 2, and twenty
 * of these links on /courses would push the page past the first network round trip.
 */
export function whatsappShareHref(courseName: string, slug: string): string {
  const text = [...shareText(courseName, slug)].map((ch) => (/[\u0621-\u064A]/.test(ch) ? ch : encodeURIComponent(ch))).join('');
  return `https://wa.me/?text=${text}`;
}
