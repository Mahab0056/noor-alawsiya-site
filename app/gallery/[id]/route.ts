import { getDb } from '@/lib/db';
import { getGalleryImage } from '@/lib/gallery';

/**
 * GET /gallery/<id>: one gallery picture, public, straight from the database.
 * A picture never changes under its id (it is only added or deleted), so browsers may keep it for a day.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = /^\d{1,12}$/.test(id) ? Number(id) : 0;
  const image = n > 0 ? await getGalleryImage(await getDb(), n) : null;
  if (!image) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(Buffer.from(image.bytes), {
    headers: {
      'Content-Type': image.mime,
      'Content-Length': String(image.bytes.length),
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
