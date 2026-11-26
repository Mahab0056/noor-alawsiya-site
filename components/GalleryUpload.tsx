'use client';

import { useActionState, useRef, useState } from 'react';
import { addImageAction, type GalleryState } from '@/app/admin/gallery/actions';
import { Field, fieldProps } from './Field';

const MAX_SIDE = 1600;

/**
 * Shrinks the picture in the browser before it is sent: a phone photo of 8 MB becomes a few hundred KB,
 * and redrawing it on a canvas drops the camera data inside the file (place, time, device).
 * If the browser cannot do it, the original file goes up and the server's own limits apply.
 */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.84));
    return blob ? { blob, width, height } : null;
  } catch {
    return null;
  }
}

export function GalleryUpload({ full }: { full: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState('');
  const [state, action, pending] = useActionState(async (prev: GalleryState, form: FormData) => {
    const file = form.get('image');
    if (file instanceof File && file.size > 0) {
      const small = await shrink(file);
      if (small) {
        form.set('image', small.blob, 'photo.jpg');
        form.set('width', String(small.width));
        form.set('height', String(small.height));
      }
    }
    const result = await addImageAction(prev, form);
    if (result && !result.error) {
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
    }
    return result;
  }, undefined);
  const error = state?.error;

  return (
    <form action={action} noValidate>
      {error ? (
        <p className="alert bad" role="alert">
          {error}
        </p>
      ) : null}
      {state?.saved && !error ? (
        <p className="alert ok" role="status">
          أُضيفت الصورة إلى آخر المعرض.
        </p>
      ) : null}
      {full ? <p className="alert info">المعرض ممتلئ. احذف صورة قديمة حتى تضيف صورة جديدة.</p> : null}
      <Field id="image" label="الصورة" hint="JPG أو PNG أو WebP. تُصغَّر تلقائياً قبل الرفع." required>
        <input {...fieldProps('image', { hint: true, required: true })} ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={full} />
      </Field>
      <Field id="caption" label="وصف الصورة" hint="سطر قصير يظهر تحت الصورة ويقرؤه قارئ الشاشة. اختياري.">
        <input {...fieldProps('caption', { hint: true })} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={140} disabled={full} />
      </Field>
      <button className="btn k" type="submit" disabled={pending || full} style={{ marginTop: 4 }}>
        {pending ? 'جارٍ الرفع…' : 'إضافة الصورة'}
      </button>
    </form>
  );
}
