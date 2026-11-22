import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CSSProperties } from 'react';
import { ImageResponse } from 'next/og';
import { COURSE_PAGES, courseBySlug } from '@/lib/share';
import { KIND_TAG } from '@/lib/data';
import { visualWords } from '@/lib/og-arabic';

/**
 * The link card WhatsApp (and any other app) shows for one course: 1200×630, the site's black canvas and yellow
 * accent, IBM Plex Sans Arabic (the site's UI font, OFL file in assets/fonts), the yellow logo mark.
 *
 * Satori (ImageResponse's engine) lays words out left to right, measures Arabic words unjoined (uneven gaps), and
 * cannot shape Aref Ruqaa at all (letters come out unjoined), so the school name uses Plex too. Each line is split into
 * words pre-shaped by lib/og-arabic.ts and drawn in a `row-reverse` wrapping row: right-to-left order, exact widths.
 * Rendered once per course and kept by Next's cache ('use cache'); nothing about the visitor is read.
 */

export function generateStaticParams() {
  return COURSE_PAGES.map(({ slug }) => ({ slug }));
}

const Y = '#fffa00';
const K = '#0b0b0c';

/** One right-to-left line of Arabic for Satori: words in a row-reverse wrapping flex row. */
function Rtl({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row-reverse', flexWrap: 'wrap', columnGap: '0.28em', ...style }}>
      {visualWords(text).map((w, i) => (
        <span key={i}>{w}</span>
      ))}
    </div>
  );
}

async function cardPng(slug: string): Promise<Uint8Array | null> {
  'use cache';
  const course = courseBySlug(slug);
  if (!course) return null;
  const [ui, mark] = await Promise.all([
    readFile(path.join(process.cwd(), 'assets/fonts/IBMPlexSansArabic-Bold.ttf')),
    readFile(path.join(process.cwd(), 'public/img/mark-yellow.png')),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString('base64')}`;
  const status = course.status === 'open' ? 'قائمة الآن' : course.status === 'done' ? 'تخرّجت' : null;
  const tags = [course.kind ? KIND_TAG[course.kind] : null, status].filter((t): t is string => t !== null);
  // Long names step down so they stay within two lines.
  const nameSize = course.name.length > 30 ? 68 : course.name.length > 22 ? 78 : 88;

  const res = new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: K, padding: 28, fontFamily: 'Plex', color: '#fff' }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            border: `4px solid ${Y}`,
            borderRadius: 30,
            padding: '44px 60px 38px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row-reverse', gap: 14 }}>
            {tags.map((t, i) => (
              <div
                key={t}
                style={{
                  display: 'flex',
                  fontSize: 30,
                  padding: '4px 24px',
                  borderRadius: 999,
                  background: i === 0 ? Y : 'transparent',
                  color: i === 0 ? K : Y,
                  border: `2px solid ${Y}`,
                }}
              >
                <Rtl text={t} style={{ flexWrap: 'nowrap' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', alignItems: 'stretch' }}>
            <Rtl text={course.name} style={{ fontSize: nameSize, lineHeight: 1.3 }} />
            <Rtl text={`بإشراف ${course.teacher}`} style={{ fontSize: 34, color: '#cfcfcf', marginTop: 14 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', gap: 22, borderTop: '2px solid #2c2c2e', paddingTop: 24 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain <img> only */}
            <img src={markSrc} width={62} height={80} alt="" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <Rtl text="مدرسة نور الأوصياء" style={{ fontSize: 44, color: Y, lineHeight: 1.2 }} />
              <Rtl text="للدراسات القرآنية · بغداد" style={{ fontSize: 26, color: '#b9b9b9' }} />
            </div>
            <div style={{ display: 'flex', marginRight: 'auto', fontSize: 26, color: '#b9b9b9' }}>noor-alawsiya.com</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: [{ name: 'Plex', data: ui, weight: 700, style: 'normal' }] },
  );
  return new Uint8Array(await res.arrayBuffer());
}

export async function GET(_req: Request, ctx: RouteContext<'/courses/[slug]/og.png'>) {
  const { slug } = await ctx.params;
  const png = await cardPng(slug);
  if (!png) return new Response('Not found', { status: 404 });
  return new Response(png as BodyInit, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  });
}
