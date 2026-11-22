import type { MetadataRoute } from 'next';
import { COURSE_PAGES, coursePath } from '@/lib/share';

const ORIGIN = 'https://noor-alawsiya.com';

// Public pages only. No lastModified: the site has no real edit dates to report.
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['/', '/courses', '/register', '/privacy', ...COURSE_PAGES.map(({ slug }) => coursePath(slug))];
  return pages.map((path) => ({ url: `${ORIGIN}${path}` }));
}
