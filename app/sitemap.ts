import type { MetadataRoute } from 'next';
import { getPublicCourses } from '@/lib/public-courses-cache';
import { sitemapEntries } from '@/lib/seo';

// Public pages, plus the pages of the courses that take registrations now (lib/seo.ts sitemapEntries). It reads the
// same cached view as the course pages, so opening or closing a course in «الدورات» changes it too.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const live = await getPublicCourses();
  return sitemapEntries(live?.openByName ?? null);
}
