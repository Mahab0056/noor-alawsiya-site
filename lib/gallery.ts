import 'server-only';
import type { Db } from './db';

/**
 * The photo gallery: pictures an admin uploads, shown on the home page.
 * Callers must have checked the admin session first (see lib/session.ts requireAdmin).
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 60;
export const MAX_CAPTION = 140;

export type GalleryMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type GalleryItem = { id: number; caption: string; width: number; height: number };

export class GalleryError extends Error {
  constructor(public code: 'empty' | 'too-big' | 'bad-type' | 'full' | 'caption') {
    super(code);
  }
}

/** The real type, read from the first bytes. The browser's own label is never trusted. */
export function sniffImage(bytes: Uint8Array): GalleryMime | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

const clampSide = (n: number) => (Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 10000) : 0);

async function audit(db: Db, adminId: number, action: string, target: string, detail?: Record<string, unknown>) {
  await db.query('insert into audit_log (admin_id, action, target, detail) values ($1, $2, $3, $4)', [adminId, action, target, detail ? JSON.stringify(detail) : null]);
}

export async function listGallery(db: Db): Promise<GalleryItem[]> {
  const rows = await db.query<{ id: string; caption: string; width: number; height: number }>('select id, caption, width, height from gallery_images order by position, id');
  return rows.map((r) => ({ id: Number(r.id), caption: r.caption, width: r.width, height: r.height }));
}

export async function getGalleryImage(db: Db, id: number): Promise<{ mime: GalleryMime; bytes: Uint8Array } | null> {
  const [r] = await db.query<{ mime: GalleryMime; bytes: Uint8Array }>('select mime, bytes from gallery_images where id = $1', [id]);
  return r ? { mime: r.mime, bytes: r.bytes } : null;
}

export async function addGalleryImage(db: Db, adminId: number, input: { bytes: Uint8Array; caption: string; width: number; height: number }) {
  const caption = input.caption.trim();
  if (input.bytes.length === 0) throw new GalleryError('empty');
  if (input.bytes.length > MAX_IMAGE_BYTES) throw new GalleryError('too-big');
  if (caption.length > MAX_CAPTION) throw new GalleryError('caption');
  const mime = sniffImage(input.bytes);
  if (!mime) throw new GalleryError('bad-type');
  // The sizes only shape the layout before the picture loads; a wrong pair falls back to 4:3.
  const width = clampSide(input.width) || 1200;
  const height = clampSide(input.height) || 900;
  return db.tx(async (t) => {
    const [{ n, next }] = await t.query<{ n: number; next: number }>('select count(*)::int as n, coalesce(max(position), 0) + 1 as next from gallery_images');
    if (n >= MAX_IMAGES) throw new GalleryError('full');
    const [row] = await t.query<{ id: string }>(
      'insert into gallery_images (caption, mime, bytes, width, height, position, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id',
      [caption, mime, Buffer.from(input.bytes), width, height, next, adminId]
    );
    await audit(t, adminId, 'gallery.add', `gallery:${row.id}`, { bytes: input.bytes.length, mime });
    return Number(row.id);
  });
}

export async function setGalleryCaption(db: Db, adminId: number, id: number, caption: string) {
  const text = caption.trim();
  if (text.length > MAX_CAPTION) throw new GalleryError('caption');
  await db.tx(async (t) => {
    const rows = await t.query('update gallery_images set caption = $2 where id = $1 returning id', [id, text]);
    if (rows.length) await audit(t, adminId, 'gallery.caption', `gallery:${id}`);
  });
}

/** Moves a picture one place earlier or later, then renumbers every position so ties cannot build up. */
export async function moveGalleryImage(db: Db, adminId: number, id: number, direction: 'up' | 'down') {
  await db.tx(async (t) => {
    const order = (await t.query<{ id: string }>('select id from gallery_images order by position, id')).map((r) => Number(r.id));
    const from = order.indexOf(id);
    const to = from + (direction === 'up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    for (const [i, imageId] of order.entries()) await t.query('update gallery_images set position = $2 where id = $1', [imageId, i + 1]);
    await audit(t, adminId, 'gallery.move', `gallery:${id}`, { direction });
  });
}

export async function deleteGalleryImage(db: Db, adminId: number, id: number) {
  await db.tx(async (t) => {
    const rows = await t.query('delete from gallery_images where id = $1 returning id', [id]);
    if (rows.length) await audit(t, adminId, 'gallery.delete', `gallery:${id}`);
  });
}
