import 'server-only';
import { deflateSync } from 'node:zlib';
import qrcode from 'qrcode-generator';

/**
 * QR codes for «روابط الحملات», made on the server with qrcode-generator (already used for the old authenticator QR).
 * No outside service sees the link. Two files per link:
 * - SVG: vector, for the print shop (any size stays sharp);
 * - PNG: at least 1024 px, black on white, 300 dpi in the file (≈ 8.7 cm wide), for Instagram and quick printing.
 *
 * Error correction Q (about 25% may be damaged or covered): a poster on a mosque board gets folded and pinned.
 * Quiet zone of 4 modules, as the QR standard asks, so a scanner finds the code on a busy poster.
 */

const QUIET = 4;

/** Dark modules, row by row. Only ASCII is accepted: lib/campaign-links.ts builds ASCII links, and byte mode would mangle anything else. */
export function qrMatrix(text: string): boolean[][] {
  if (!/^[\x20-\x7e]+$/.test(text)) throw new Error('QR text must be printable ASCII');
  const qr = qrcode(0, 'Q');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** One SVG path for all dark modules, a horizontal run per command, in module units with the quiet zone included. */
export function qrPath(m: boolean[][]): string {
  let d = '';
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      d += `M${x + QUIET} ${y + QUIET}h${w}v1h-${w}z`;
      x += w - 1;
    }
  });
  return d;
}

/** Side of the whole image in modules, quiet zone included. */
export const qrSide = (m: boolean[][]) => m.length + 2 * QUIET;

export function qrSvg(text: string): string {
  const m = qrMatrix(text);
  const s = qrSide(m);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s * 10}" height="${s * 10}" shape-rendering="crispEdges">` +
    `<rect width="${s}" height="${s}" fill="#fff"/><path fill="#000" d="${qrPath(m)}"/></svg>\n`
  );
}

// ---------------------------------------------------------------- PNG (1-bit greyscale), no image library

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Pixels per module so that the image is at least `minPx` wide. */
export const pngScale = (m: boolean[][], minPx = 1024) => Math.ceil(minPx / qrSide(m));

export function qrPng(text: string, minPx = 1024): Buffer {
  const m = qrMatrix(text);
  const scale = pngScale(m, minPx);
  const side = qrSide(m) * scale;
  const rowBytes = Math.ceil(side / 8);
  const raw = Buffer.alloc((rowBytes + 1) * side, 0);
  for (let y = 0; y < side; y++) {
    const my = Math.floor(y / scale) - QUIET;
    const off = y * (rowBytes + 1);
    raw[off] = 0; // filter: none
    for (let x = 0; x < rowBytes * 8; x++) {
      const mx = Math.floor(x / scale) - QUIET;
      const dark = x < side && my >= 0 && my < m.length && mx >= 0 && mx < m.length && m[my][mx];
      // 1-bit greyscale: 1 = white, 0 = black. Padding bits past the edge are white.
      if (!dark) raw[off + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // greyscale
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering (every row uses «none»)
  ihdr[12] = 0; // no interlace
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(11811, 0); // 300 dpi
  phys.writeUInt32BE(11811, 4);
  phys[8] = 1; // per metre
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('pHYs', phys),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
