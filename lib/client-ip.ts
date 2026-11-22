import { isIP } from 'node:net';

/** See clientIp() in lib/session.ts. Pure, so it can be tested without a request. */
export function pickClientIp(realIp: string | null, forwardedFor: string | null) {
  const real = realIp?.trim() ?? '';
  if (isIP(real)) return real;
  const last = forwardedFor?.split(',').at(-1)?.trim() ?? '';
  return isIP(last) ? last : 'unknown';
}
