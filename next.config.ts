import type { NextConfig } from 'next';
import { contentSecurityPolicy } from './lib/csp';

const nextConfig: NextConfig = {
  // No «x-powered-by: Next.js» on every answer: it only tells a scanner what to try.
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite (the local development database) loads its own wasm files from disk, so it must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite'],
  // Mobile speed (variant B): AVIF first (smaller than WebP for the hero photo), and allow quality 60 for the hero.
  images: { formats: ['image/avif', 'image/webp'], qualities: [60, 75] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy(process.env.NODE_ENV === 'development') },
        ],
      },
    ];
  },
};

export default nextConfig;
