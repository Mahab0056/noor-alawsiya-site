// Renders the certificate mock-up to PNG boards + PDFs and runs the acceptance checks (SPEC.md §9). Writes checks.json.
//
//   node docs/design/certificate/tools/shots.mjs
//
// Needs (not in package.json, design tooling only):
//   CERT_PW      folder that holds `playwright` (a node_modules dir)
//   CERT_CHROME  Chromium / chrome-headless-shell executable (optional if Playwright's own browser is installed)
//   CERT_JSQR    path to jsqr's dist/jsQR.js (reads the QR back from the rendered PNGs)
//   pdftotext    on PATH (optional; the text-extraction check is skipped without it)
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const boards = path.join(root, 'boards');
const pdfDir = path.join(root, 'pdf');
fs.mkdirSync(boards, { recursive: true });
fs.mkdirSync(pdfDir, { recursive: true });

const require = createRequire(path.join(process.env.CERT_PW ?? path.join(here, '../../../../node_modules'), 'x.js'));
const { chromium } = require('playwright');
const browser = await chromium.launch(process.env.CERT_CHROME ? { executablePath: process.env.CERT_CHROME } : {});
const mock = pathToFileURL(path.join(root, 'mock/certificate.html')).href;
const verifyMock = pathToFileURL(path.join(root, 'mock/verify.html')).href;

const BOARD = ['base', 'long40', 'long58', 'max80', 'wide', 'sparse', 'fullest'];
const CHECK_ONLY = ['stress80', 'onetoken'];
const VIEW = { a4: { width: 1123, height: 794, dsf: 1.5 }, sq: { width: 1080, height: 1080, dsf: 1 } };
const MM = 96 / 25.4;
const SAMPLE_URL = 'https://noor-alawsiya.com/c/00EXAMP1';

const checks = { generated: new Date().toISOString().slice(0, 10), fit: [], contrast: {}, bidi: [], yellow: [], qr: [], pdf: [], verifyPage: [], negativeControl: null, failures: [] };
const fail = (what) => { checks.failures.push(what); console.log('FAIL', what); };

async function open(format, sample, extra = '') {
  const v = VIEW[format];
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dsf });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`pageerror ${format}/${sample}: ${e.message}`));
  await page.goto(`${mock}?bare=1&f=${format}&s=${sample}${extra}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  return { ctx, page };
}

/** Geometry checks, run inside the page. */
function measure({ format, MM }) {
  const cert = document.getElementById('cert');
  const C = cert.getBoundingClientRect();
  const safe = format === 'a4' ? 12 * MM : 30; // A4: 12 mm from the paper edge. Square: 30 px.
  const out = { problems: [] };
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const textRect = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };

  // 1. every piece of text sits inside the safe area
  const sel = ['.school', '.title', '.lead', '#name span', '.for', '#course', '.meta', '.sig b', '.sig small', '.verify small', '.verify .code', '.verify .url', '.issued', '.org'];
  for (const s of sel) for (const el of cert.querySelectorAll(s)) {
    if (!shown(el)) continue;
    const r = textRect(el);
    if (r.left < C.left + safe - 0.5 || r.right > C.right - safe + 0.5 || r.top < C.top + safe - 0.5 || r.bottom > C.bottom - safe + 0.5)
      out.problems.push(`${s} leaves the safe area`);
  }
  // 2. the name: every line inside its box, at most two lines, the lines fit the box height
  const name = document.getElementById('name');
  const N = name.getBoundingClientRect();
  const spans = [...name.querySelectorAll('span')];
  let widest = 0, linesH = 0;
  for (const sp of spans) {
    const r = textRect(sp);
    widest = Math.max(widest, r.width);
    linesH += sp.getBoundingClientRect().height;
    if (r.left < N.left - 0.5 || r.right > N.right + 0.5) out.problems.push('name wider than its box');
  }
  if (spans.length > 2) out.problems.push('name on more than two lines');
  if (linesH > N.height + 0.5) out.problems.push('name lines taller than the name box');
  out.name = { step: name.dataset.step, size: Number(name.dataset.size), lines: spans.length, widthUsed: Math.round((widest / N.width) * 100) + '%' };
  if (name.dataset.step === 'reject') out.problems.push('name below the minimum size (reject)');
  // 3. stepped fields do not overflow
  const lineCount = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = [...r.getClientRects()].map((q) => q.top).sort((a, b) => a - b);
    const half = parseFloat(getComputedStyle(el).fontSize) / 2;
    let n = 0, lastTop = -1e9;
    for (const t of tops) if (t - lastTop > half) { n++; lastTop = t; }
    return n;
  };
  for (const s of ['#course', '.meta', '.sig b']) for (const el of cert.querySelectorAll(s)) {
    if (!shown(el)) continue;
    const box = el.getBoundingClientRect(), tr = textRect(el);
    if (lineCount(el) > Number(el.dataset.maxLines)) out.problems.push(`${s} needs more lines than step ${el.dataset.step} allows`);
    if (tr.left < box.left - 0.5 || tr.right > box.right + 0.5) out.problems.push(`${s} is wider than its box`);
  }
  out.steps = { course: document.getElementById('course').dataset.step, meta: cert.querySelector('.meta').dataset.step, teacher: cert.querySelector('.sig b').dataset.step };
  // 4. the column of content ends above the frame / the verify band
  const last = format === 'a4' ? cert.querySelector('.issued') : cert.querySelector('.meta');
  const limit = format === 'a4' ? C.bottom - 12 * MM : cert.querySelector('.frame').getBoundingClientRect().bottom - 12;
  if (last.getBoundingClientRect().bottom > limit + 0.5) out.problems.push('content runs past the bottom of the frame');
  if (format === 'a4') {
    const foot = cert.querySelector('.foot').getBoundingClientRect(), meta = cert.querySelector('.meta').getBoundingClientRect();
    if (foot.top < meta.bottom + 3 * MM) out.problems.push('signatures closer than 3 mm to the dates line');
    const qr = cert.querySelector('.qr').getBoundingClientRect();
    out.qrMm = +(qr.width / MM).toFixed(2);
  }
  // 5. direction
  out.dir = { cert: getComputedStyle(cert).direction, ltr: [...cert.querySelectorAll('.ltr')].filter(shown).map((e) => getComputedStyle(e).direction + '/' + getComputedStyle(e).unicodeBidi) };
  return out;
}

/** Order of characters as painted (never judged by eye). */
function bidi() {
  const cert = document.getElementById('cert');
  const res = [];
  const node = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, last = null; while ((n = w.nextNode())) last = n; return last; };
  const x = (n, i) => { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect(); return (b.left + b.right) / 2; };
  const shown = (el) => el && el.getClientRects().length > 0;
  // name: first letter is on the right of the last letter
  const nm = node(cert.querySelector('#name span'));
  res.push({ what: 'name reads right to left', ok: x(nm, 0) > x(nm, nm.length - 1) });
  // dates: the digits of a year run left to right, and the year is on the left of the month name before it
  const mt = node(cert.querySelector('.meta'));
  const t = mt.textContent;
  const yi = t.search(/[٠-٩]{4}(?![\s\S]*[٠-٩]{4})/);
  if (yi >= 0) {
    res.push({ what: 'digits of the year run left to right', ok: x(mt, yi) < x(mt, yi + 1) && x(mt, yi + 1) < x(mt, yi + 2) && x(mt, yi + 2) < x(mt, yi + 3) });
    const before = t.lastIndexOf(' ', yi - 2);
    res.push({ what: 'year sits to the left of the month name', ok: x(mt, yi + 3) < x(mt, before + 1) });
  }
  for (const s of ['.verify .code', '.verify .url']) {
    const el = cert.querySelector(s);
    if (!shown(el)) continue;
    const n = node(el);
    res.push({ what: `${s} reads left to right`, ok: x(n, 0) < x(n, n.length - 1) });
  }
  const co = node(cert.querySelector('#course'));
  const p = co.textContent.indexOf('(');
  if (p >= 0 && co.textContent[p + 2] === ')') res.push({ what: 'brackets of the honorific keep their order', ok: x(co, p) > x(co, p + 1) && x(co, p + 1) > x(co, p + 2) });
  return res;
}

/** Colour pairs actually used, with the WCAG ratio in colour and after a grey conversion (Rec. 601 luma, as `filter: grayscale`). */
function contrast() {
  const cert = document.getElementById('cert');
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const [hi, lo] = [L(a), L(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const grey = (c) => { const y = Math.round(0.299 * c.r + 0.587 * c.g + 0.114 * c.b); return { r: y, g: y, b: y }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) return c; } return { r: 255, g: 255, b: 255 }; };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const rows = new Map();
  for (const el of cert.querySelectorAll('.specimen, .school, .title, .lead, #name, .for, #course, .meta, .sig b, .sig small, .verify small, .verify .code, .verify .url, .issued, .org, .org small')) {
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color), bg = bgOf(el);
    const px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const key = hex(fg) + ' on ' + hex(bg) + (large ? ' (large)' : '');
    const row = rows.get(key) ?? { pair: key, min: large ? 3 : 4.5, colour: +ratio(fg, bg).toFixed(2), grey: +ratio(grey(fg), grey(bg)).toFixed(2), greyPair: hex(grey(fg)) + ' on ' + hex(grey(bg)), smallestPx: px, used: [] };
    row.smallestPx = Math.min(row.smallestPx, px);
    const label = (el.parentElement.classList[0] ? '.' + el.parentElement.classList[0] + ' ' : '') + (el.id ? '#' + el.id : el.classList.length ? '.' + el.classList[0] : el.tagName.toLowerCase());
    if (!row.used.includes(label)) row.used.push(label);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** Yellow never carries meaning on paper: every yellow shape on A4 is bounded by black. */
function yellowBounded() {
  const cert = document.getElementById('cert');
  const isK = (c) => c.replace(/\s/g, '') === 'rgb(11,11,12)';
  const res = [];
  for (const s of ['.crest', '.bar', '.rule i']) {
    const cs = getComputedStyle(cert.querySelector(s));
    res.push({ shape: s, ok: isK(cs.borderTopColor) && parseFloat(cs.borderTopWidth) > 0 });
  }
  const f = cert.querySelector('.frame');
  res.push({ shape: 'frame band', ok: isK(getComputedStyle(f).borderTopColor) && isK(getComputedStyle(f, '::after').borderTopColor) && parseFloat(getComputedStyle(f, '::after').borderTopWidth) > 0 });
  res.push({ shape: 'corner stars', ok: [...cert.querySelectorAll('.star g')].every((g) => g.getAttribute('stroke') === '#0b0b0c') });
  return res;
}

async function readQr(pngPath) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  await page.addScriptTag({ path: process.env.CERT_JSQR });
  const b64 = fs.readFileSync(pngPath).toString('base64');
  const text = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    const r = window.jsQR(d.data, d.width, d.height);
    return r ? r.data : null;
  }, 'data:image/png;base64,' + b64);
  await ctx.close();
  return text;
}

// ---------- certificate renders + checks ----------
const GREY = ['base', 'max80', 'fullest'];
for (const format of ['a4', 'sq']) {
  for (const sample of [...BOARD, ...CHECK_ONLY]) {
    const { ctx, page } = await open(format, sample);
    const m = await page.evaluate(measure, { format, MM });
    const b = await page.evaluate(bidi);
    // ink: the name's descenders must not touch the divider under it
    const clip = await page.locator('.rule').boundingBox();
    const withName = await page.screenshot({ clip });
    await page.evaluate(() => { document.getElementById('name').style.visibility = 'hidden'; });
    const withoutName = await page.screenshot({ clip });
    await page.evaluate(() => { document.getElementById('name').style.visibility = ''; });
    if (!withName.equals(withoutName)) m.problems.push('ink of the name touches the divider');
    if (m.dir.cert !== 'rtl' || m.dir.ltr.some((d) => d !== 'ltr/isolate')) m.problems.push('direction is wrong');
    for (const r of b) if (!r.ok) m.problems.push('bidi: ' + r.what);
    checks.fit.push({ format, sample, ...m.name, ...m.steps, problems: m.problems });
    checks.bidi.push({ format, sample, results: b });
    for (const p of m.problems) fail(`${format}/${sample}: ${p}`);
    if (format === 'a4' && sample === 'base') checks.qrSizeMm = m.qrMm;

    if (BOARD.includes(sample)) {
      await page.locator('#cert').screenshot({ path: path.join(boards, `${format}-${sample}.png`) });
      if (GREY.includes(sample)) {
        if (format === 'a4') await page.emulateMedia({ media: 'print' });
        await page.evaluate(() => document.body.classList.add('grey'));
        await page.locator('#cert').screenshot({ path: path.join(boards, `grey-${format}-${sample}.png`) });
        await page.evaluate(() => document.body.classList.remove('grey'));
        if (format === 'a4') {
          await page.pdf({ path: path.join(pdfDir, `certificate-${sample}.pdf`), preferCSSPageSize: true, printBackground: true });
          await page.emulateMedia({ media: 'screen' });
        }
      }
    }
    if (sample === 'base') {
      checks.contrast[format] = await page.evaluate(contrast);
      for (const r of checks.contrast[format]) {
        if (r.colour < r.min) fail(`${format} contrast ${r.pair}: ${r.colour}`);
        if (r.grey < r.min) fail(`${format} grey contrast ${r.pair}: ${r.grey}`);
      }
      if (format === 'a4') {
        checks.yellow = await page.evaluate(yellowBounded);
        for (const y of checks.yellow) if (!y.ok) fail(`yellow shape without a black edge: ${y.shape}`);
      }
    }
    await ctx.close();
  }
}

// name font: Amiri (chosen) against Aref Ruqaa, for the record
for (const sample of ['base', 'long58']) {
  const { ctx, page } = await open('a4', sample, '&nf=ruqaa');
  await page.locator('#cert').screenshot({ path: path.join(boards, `option-ruqaa-a4-${sample}.png`) });
  await ctx.close();
}
// how the square reads at feed size on a phone (360 px wide)
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(path.join(boards, 'sq-max80.png')).toString('base64')}" style="width:360px;height:360px;display:block"></body>`);
  await page.screenshot({ path: path.join(boards, 'sq-max80-at-360.png') });
  await ctx.close();
}

// negative control: with the fit rule switched off, the same checks must object to the 80-character name
{
  const { ctx, page } = await open('a4', 'max80', '&nofit=1');
  const m = await page.evaluate(measure, { format: 'a4', MM });
  checks.negativeControl = { what: 'a4/max80 with ?nofit=1', caught: m.problems.length > 0, problems: m.problems };
  if (!m.problems.length) fail('negative control: the checker did not catch an overflowing name');
  await ctx.close();
}

// ---------- QR reads back ----------
if (process.env.CERT_JSQR) {
  for (const f of ['a4-base.png', 'grey-a4-base.png', 'a4-fullest.png']) {
    const text = await readQr(path.join(boards, f));
    const ok = text === SAMPLE_URL;
    checks.qr.push({ image: f, decoded: text, ok });
    if (!ok) fail(`QR in ${f} decoded to ${text}`);
  }
} else checks.qr.push({ skipped: 'CERT_JSQR not set' });

// ---------- PDF ----------
for (const sample of GREY) {
  const file = path.join(pdfDir, `certificate-${sample}.pdf`);
  const raw = fs.readFileSync(file).toString('latin1');
  const pages = (raw.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
  const box = raw.match(/\/MediaBox\s*\[\s*([\d.\s]+)\]/)?.[1].trim().split(/\s+/).map(Number);
  const fonts = [...new Set([...raw.matchAll(/\/FontName\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1]))].sort();
  const embedded = (raw.match(/\/FontFile[23]?\b/g) ?? []).length;
  const type3 = (raw.match(/\/Subtype\s*\/Type3/g) ?? []).length;
  let text = null;
  try { text = execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8' }); } catch { /* optional */ }
  const row = { file: `pdf/certificate-${sample}.pdf`, bytes: fs.statSync(file).size, pages, mediaBoxPt: box, fonts, embeddedFontFiles: embedded, type3Fonts: type3 };
  if (text !== null) row.textHasCode = text.includes('00EX-AMP1');
  const a4 = box && Math.abs(box[2] - 841.89) < 1 && Math.abs(box[3] - 595.28) < 1;
  const want = ['Amiri', 'ArefRuqaa', 'IBMPlexSansArabic'];
  row.ok = pages === 1 && !!a4 && want.every((w) => fonts.some((f) => f.includes(w))) && embedded >= 3 && type3 === 0;
  if (!row.ok) fail(`PDF ${sample}: ${JSON.stringify(row)}`);
  checks.pdf.push(row);
}

// ---------- verify page: 375 / 768 / 1440 ----------
for (const state of ['valid', 'revoked', 'unknown', 'form', 'busy']) {
  for (const w of [375, 768, 1440]) {
    if (w !== 375 && state !== 'valid') continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 375 ? 760 : 900 }, deviceScaleFactor: w === 375 ? 2 : 1 });
    const page = await ctx.newPage();
    await page.goto(`${verifyMock}?state=${state}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const small = [...document.querySelectorAll('.verify a.btn, .verify button, .verify input')].map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 44);
      return { sideScroll: de.scrollWidth > de.clientWidth, tapsUnder44: small, dir: getComputedStyle(document.querySelector('.verify')).direction };
    });
    checks.verifyPage.push({ state, width: w, ...r });
    if (r.sideScroll) fail(`verify ${state}@${w}: side scroll`);
    if (r.tapsUnder44.length) fail(`verify ${state}@${w}: tap targets under 44px: ${r.tapsUnder44}`);
    await page.screenshot({ path: path.join(boards, `verify-${state}-${w}${w === 375 ? '@2x' : ''}.png`), fullPage: true });
    await ctx.close();
  }
}

// ---------- contact sheets ----------
async function sheet(name, files, cols, cellW, label) {
  const ctx = await browser.newContext({ viewport: { width: cols * (cellW + 24) + 24, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cells = files.map(([f, cap]) => `<figure><img src="data:image/png;base64,${fs.readFileSync(path.join(boards, f)).toString('base64')}" width="${cellW}"><figcaption>${cap}</figcaption></figure>`).join('');
  await page.setContent(`<html dir="rtl"><body style="margin:0;background:#e9e6d9;font:15px 'Segoe UI',sans-serif;color:#17171a"><h1 style="font-size:20px;margin:0;padding:18px 24px 0">${label}</h1><div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:24px;padding:18px 24px 24px">${cells}</div><style>figure{margin:0}img{display:block;box-shadow:0 2px 12px rgba(0,0,0,.18)}figcaption{padding-top:8px}</style></body></html>`);
  await page.screenshot({ path: path.join(boards, name), fullPage: true });
  await ctx.close();
}
const captions = JSON.parse(fs.readFileSync(path.join(here, 'captions.json'), 'utf8'));
await sheet('board-a4.png', BOARD.map((s) => [`a4-${s}.png`, captions[s]]).concat([['grey-a4-base.png', captions.grey]]), 2, 842, captions.titleA4);
await sheet('board-square.png', BOARD.map((s) => [`sq-${s}.png`, captions[s]]).concat([['grey-sq-base.png', captions.grey]]), 4, 540, captions.titleSquare);
await sheet('board-print-grey.png', GREY.map((s) => [`grey-a4-${s}.png`, captions[s]]), 1, 1123, captions.titleGrey);

await browser.close();
checks.ok = checks.failures.length === 0;
fs.writeFileSync(path.join(root, 'checks.json'), JSON.stringify(checks, null, 1) + '\n');
console.log(checks.ok ? 'ALL CHECKS PASS' : `${checks.failures.length} FAILURE(S)`);
process.exit(checks.ok ? 0 : 1);
