'use server';

import { refresh } from 'next/cache';
import { getDb } from '@/lib/db';
import { addGalleryImage, deleteGalleryImage, GalleryError, MAX_IMAGE_BYTES, moveGalleryImage, setGalleryCaption } from '@/lib/gallery';
import { requireAdmin } from '@/lib/session';

// Every action below checks the admin session itself. A Server Action is a public endpoint.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};
const id = (form: FormData) => {
  const n = Number(text(form, 'id'));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const MESSAGE: Record<GalleryError['code'], string> = {
  empty: 'اختر صورة أولاً.',
  'too-big': 'الصورة أكبر من ٥ ميغابايت. اختر صورة أصغر.',
  'bad-type': 'نوع الملف غير مقبول. المقبول: JPG أو PNG أو WebP.',
  full: 'المعرض ممتلئ. احذف صورة قديمة ثم أضف الجديدة.',
  caption: 'الوصف طويل جداً (١٤٠ حرفاً على الأكثر).',
};

export type GalleryState = { error?: string; saved: number } | undefined;

export async function addImageAction(prev: GalleryState, form: FormData): Promise<GalleryState> {
  const admin = await requireAdmin();
  const saved = prev?.saved ?? 0;
  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) return { error: MESSAGE.empty, saved };
  if (file.size > MAX_IMAGE_BYTES) return { error: MESSAGE['too-big'], saved };
  try {
    await addGalleryImage(await getDb(), admin.id, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      caption: text(form, 'caption'),
      width: Number(text(form, 'width')),
      height: Number(text(form, 'height')),
    });
  } catch (e) {
    if (e instanceof GalleryError) return { error: MESSAGE[e.code], saved };
    throw e;
  }
  refresh();
  return { saved: saved + 1 };
}

export async function captionAction(form: FormData) {
  const admin = await requireAdmin();
  const imageId = id(form);
  if (imageId) {
    try {
      await setGalleryCaption(await getDb(), admin.id, imageId, text(form, 'caption'));
    } catch (e) {
      if (!(e instanceof GalleryError)) throw e; // an over-long caption is simply not saved; the field's maxLength stops it first
    }
  }
  refresh();
}

export async function moveImageAction(form: FormData) {
  const admin = await requireAdmin();
  const imageId = id(form);
  const direction = text(form, 'direction');
  if (imageId && (direction === 'up' || direction === 'down')) await moveGalleryImage(await getDb(), admin.id, imageId, direction);
  refresh();
}

export async function deleteImageAction(form: FormData) {
  const admin = await requireAdmin();
  const imageId = id(form);
  if (imageId) await deleteGalleryImage(await getDb(), admin.id, imageId);
  refresh();
}
