/** The one public address of the site. Every other public name for it (today: www) is sent here. */
export const CANONICAL_HOST = 'noor-alawsiya.com';

/** Names that must answer with a permanent redirect to CANONICAL_HOST. Anything else (localhost, Railway's own *.up.railway.app name, the apex) is served as is. */
const REDIRECT_HOSTS = new Set([`www.${CANONICAL_HOST}`]);

/**
 * The host the visitor typed: x-forwarded-host first (set by Railway's edge), else Host. Lower case, with no port and
 * no trailing dot. Only the first value counts when a proxy chain sends a list.
 */
export function requestHost(forwardedHost: string | null, host: string | null): string {
  const raw = (forwardedHost || host || '').split(',')[0].trim().toLowerCase();
  return raw.replace(/:\d+$/, '').replace(/\.$/, '');
}

/**
 * The absolute URL to redirect to, or null when this host is served as is. Built from fixed parts, never from
 * request.url, so the container's own port (Railway runs it on 8080) cannot leak into the Location header.
 */
export function canonicalRedirect(host: string, pathname: string, search: string): string | null {
  if (!REDIRECT_HOSTS.has(host)) return null;
  return `https://${CANONICAL_HOST}${pathname}${search}`;
}
