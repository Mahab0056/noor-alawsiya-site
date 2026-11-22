// Boards + checks for the fees / trial design. Static mock-up pages only (see build-mock.mjs); no app server, no database.
//
//   NODE_PATH=<folder with playwright-core and axe-core> CHROME=<chromium binary> node shots.mjs <site-dir> <boards-dir> <report.json>
//
// The two packages are not dependencies of the site, so they are loaded through NODE_PATH and not installed here.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const load = createRequire(import.meta.url);
const { chromium } = load('playwright-core');
const AXE = fs.readFileSync(load.resolve('axe-core/axe.min.js'), 'utf8');

const [SITE, OUT, REPORT] = process.argv.slice(2).map((p) => path.resolve(p));
const CHROME = process.env.CHROME || '/home/nyl/ci3/browsers/chromium-1248/chrome-linux64/chrome';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const file = path.join(SITE, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(path.resolve(SITE)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// Pages: [file, widths to shoot, widths to check only]
const PAGES = [
  ['01-unknown', [375, 768, 1440], [320]],
  ['02-filled', [375, 768, 1440], [320]],
  ['03-free-no-trial', [375, 768, 1440], [320]],
  ['04-waitlist', [375, 768, 1440], [320]],
  ['05-waitlist-open', [375], [320, 768, 1440]],
  ['06-mixed', [375], [320, 768, 1440]],
  ['states', [375, 1440], [320, 768]],
  ['admin', [375, 1440], [320, 768]],
];

// WCAG 2 contrast for one text element: its colour against the nearest solid background colour behind it.
const MEASURE = () => {
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const rgb = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { c: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = rgb(getComputedStyle(n).backgroundColor); if (b.a === 1) return b.c; } return [255, 255, 255]; };
  const scope = '.fx, .fx-set, .ctags, .cfacts .acts, .qrow';
  const texts = [];
  const seen = new Set();
  for (const root of document.querySelectorAll(scope)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!t.textContent.trim() || seen.has(el) || el.closest('.vh, .hp, option')) continue;
      const shut = el.closest('details:not([open])');
      if (shut && !el.closest('summary')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const fg = rgb(cs.color).c, bg = bgOf(el);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      texts.push({ text: t.textContent.trim().slice(0, 40), fg: fg.join(','), bg: bg.join(','), ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, size, need: large ? 3 : 4.5 });
    }
  }
  // Tap targets: every control a visitor or admin can press inside the new blocks and beside them.
  const taps = [];
  for (const el of document.querySelectorAll('.fx a, .fx button, .fx summary, .fx input, .fx select, .fx label.opt, .cfacts .acts a, .fx-set label.opt, .fx-set input.inp, .fx-set select, form.q button, .qrow .sp a, .qrow .sp button')) {
    if (el.closest('.hp')) continue;
    if (el.matches('label.opt a')) continue; // a link inside a sentence (WCAG 2.5.8 inline exception); the label is the target
    const shut = el.closest('details:not([open])');
    if (shut && !el.matches('summary')) continue; // inside a closed <details>
    if (el.matches('input[type=checkbox], input[type=radio]') && el.closest('label.opt')) continue; // the label is the target
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    taps.push({ what: (el.textContent.trim() || el.getAttribute('name') || el.tagName).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height * 10) / 10 });
  }
  return { texts, taps, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir };
};

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const report = [];
  fs.mkdirSync(OUT, { recursive: true });
  for (const [key, shoot, checkOnly] of PAGES) {
    for (const width of [...shoot, ...checkOnly]) {
      const phone = width < 500;
      const scale = phone && shoot.includes(width) ? 2 : 1;
      const ctx = await browser.newContext({ viewport: { width, height: phone ? 812 : 900 }, deviceScaleFactor: scale, hasTouch: phone, isMobile: phone, locale: 'ar-IQ' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('requestfailed', (r) => errors.push('failed ' + r.url()));
      page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
      await page.goto(`${BASE}/${key}.html`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const m = await page.evaluate(MEASURE);
      await page.addScriptTag({ content: AXE });
      const axe = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] });
        return { violations: r.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0].target}`), incomplete: r.incomplete.map((v) => `${v.id}(${v.nodes.length})`) };
      });
      const lowText = m.texts.filter((t) => t.ratio < t.need);
      const smallTaps = m.taps.filter((t) => t.h < 44 || t.w < 44);
      const pass = m.dir === 'rtl' && m.overflow <= 0 && !axe.violations.length && !lowText.length && !smallTaps.length && !errors.length;
      const minRatio = Math.min(...m.texts.map((t) => t.ratio)), minTap = Math.min(...m.taps.map((t) => Math.min(t.h, t.w)));
      console.log(`${pass ? 'PASS' : 'FAIL'} ${key}@${width}: overflow ${m.overflow}, axe ${axe.violations.length} [${axe.violations}] (incomplete ${axe.incomplete}), texts ${m.texts.length} min contrast ${minRatio}, taps ${m.taps.length} min ${minTap}px${errors.length ? ', errors ' + errors.join(' | ') : ''}`);
      for (const t of lowText) console.log('   low contrast', JSON.stringify(t));
      for (const t of smallTaps) console.log('   small tap', JSON.stringify(t));
      report.push({ page: key, width, pass, overflow: m.overflow, axe, minContrast: minRatio, minTap, texts: m.texts, taps: m.taps, errors });
      if (shoot.includes(width)) {
        // Up to the end of <main>: the footer is unchanged and only makes the board longer.
        const height = await page.evaluate(() => Math.ceil(document.querySelector('main').getBoundingClientRect().bottom + window.scrollY + 16));
        await page.screenshot({ path: path.join(OUT, `${key}-${width}${scale === 2 ? '@2x' : ''}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } });
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  const failed = report.filter((r) => !r.pass).length;
  console.log(`${report.length - failed}/${report.length} page × width checks passed`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
}
await main();
