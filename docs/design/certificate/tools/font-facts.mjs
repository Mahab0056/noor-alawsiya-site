// Prints what matters for PDF embedding from each TTF in ../fonts: OS/2 fsType (0 = installable, may be embedded and subset),
// outline format, units per em, version and licence line. Run: node docs/design/certificate/tools/font-facts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fonts');
const out = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ttf')).sort()) {
  const b = fs.readFileSync(path.join(dir, f));
  const tables = {};
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    const o = 12 + i * 16;
    tables[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) };
  }
  const name = (id) => {
    const t = tables.name.off, count = b.readUInt16BE(t + 2), str = t + b.readUInt16BE(t + 4);
    for (let i = 0; i < count; i++) {
      const r = t + 6 + i * 12;
      if (b.readUInt16BE(r + 6) !== id || b.readUInt16BE(r) !== 3) continue;
      const raw = b.subarray(str + b.readUInt16BE(r + 10), str + b.readUInt16BE(r + 10) + b.readUInt16BE(r + 8));
      return Buffer.from(raw).swap16().toString('utf16le');
    }
    return null;
  };
  out.push({
    file: f,
    bytes: b.length,
    fsType: b.readUInt16BE(tables['OS/2'].off + 8),
    outlines: tables.glyf ? 'TrueType (glyf)' : tables['CFF '] ? 'CFF' : '?',
    unitsPerEm: b.readUInt16BE(tables.head.off + 18),
    shaping: ['GSUB', 'GPOS', 'GDEF'].filter((t) => tables[t]).join('+'),
    version: name(5),
    licence: (name(13) ?? '').slice(0, 90),
  });
}
console.log(JSON.stringify(out, null, 1));
