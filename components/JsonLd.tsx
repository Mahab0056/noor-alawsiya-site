import { ldJson } from '@/lib/seo';

/** Structured data for search engines. `<` is escaped (lib/seo.ts ldJson) so no text in the data can close the script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(data) }} />;
}
