import { qrPng, qrSvg } from '@/lib/campaign-qr';
import { getCampaignLink } from '@/lib/campaigns';
import { getDb } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/session';

/**
 * GET /admin/campaigns/qr?id=<link id>&format=png|svg — the QR code of one campaign link as a download.
 * Super admins only (anyone else is sent to /admin or /admin/login, like the page). Made here; no outside service.
 */
export async function GET(request: Request) {
  await requireSuperAdmin();
  const params = new URL(request.url).searchParams;
  const format = params.get('format') === 'svg' ? 'svg' : 'png';
  const link = await getCampaignLink(await getDb(), Number(params.get('id')));
  if (!link) return new Response('غير موجود', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  const body = format === 'svg' ? qrSvg(link.url) : new Uint8Array(qrPng(link.url));
  return new Response(body, {
    headers: {
      'Content-Type': format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'image/png',
      // The name is a-z0-9- only (checked by the table), so it is safe in the header as it is.
      'Content-Disposition': `attachment; filename="noor-alawsiya-qr-${link.name}.${format}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
