/**
 * Content-Security-Policy for every page (next.config.ts). The site loads nothing from other origins: fonts come from
 * next/font (self-hosted), images from /img and /_next/image, and WhatsApp / YouTube / social links are plain links.
 *
 * - script-src keeps 'unsafe-inline' because Next writes its own inline scripts (no per-request nonce here: that would
 *   make every page dynamic). What the policy still stops: scripts, frames, forms and connections to any other origin,
 *   plugins, <base> hijacking, and being framed (with X-Frame-Options: DENY for old browsers).
 * - `next dev` also needs 'unsafe-eval' and its websocket; production never gets them.
 * - Lessons (YouTube embeds, lessons-phase3) will need `frame-src https://www.youtube-nocookie.com` added here.
 */
export function contentSecurityPolicy(dev: boolean) {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(dev ? ['ws:'] : [])],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
