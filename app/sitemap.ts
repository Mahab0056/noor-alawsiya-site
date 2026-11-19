import type { MetadataRoute } from 'next';

const ORIGIN = 'https://noor-alawsiya.com';

// Public pages only. No lastModified: the site has no real edit dates to report.
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/courses', '/register', '/privacy'].map((path) => ({ url: `${ORIGIN}${path}` }));
}
