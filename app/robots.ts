import type { MetadataRoute } from 'next';

// Only the pages that have no use in search are listed. /login also carries a noindex tag, so it is left crawlable on
// purpose: a crawler has to fetch it to see the tag.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/account'] },
    sitemap: 'https://noor-alawsiya.com/sitemap.xml',
  };
}
