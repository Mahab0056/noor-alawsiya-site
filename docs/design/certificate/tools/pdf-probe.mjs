// Feasibility probe for the build lane (SPEC.md §7): the certificate's Arabic lines written into a PDF by a small Node
// library, with the real fonts embedded, no browser. NOT the certificate renderer; it only proves the text path.
//
//   npm install pdfkit@0.21.0 bidi-js@1.1.0        (in a scratch folder, not in this repo)
//   node pdf-probe.mjs <fonts dir> <out.pdf>
//
// What the probe found with pdfkit 0.21.0 / fontkit 3.0.0 (22/11/2026):
//   1. Joining, ligatures and marks are right for all three fonts when the run is drawn with `features: ['rtla']`.
//      Without that feature pdfkit puts the words of an Arabic line in left-to-right order.
//   2. pdfkit does no bidi. A line with dates or a code must be cut into runs (bidi-js) and each run drawn on its own,
//      first logical run at the right.
//   3. Arabic-Indic digits come out reversed (٢٠٢٦ drawn as ٦٢٠٢) even as a run of their own: fontkit lays the
//      «arab» script right to left. Hand the digits over already reversed.
//   4. Brackets are not mirrored: «(ع)» is drawn «)ع(». Swap paired brackets inside right-to-left runs.
//   5. Widths from `widthOfString` equal the browser canvas widths (613.9 and 2031.4 at 100 pt for the two names below),
//      so the fit rule (§5) gives the same answer on the server.
import PDFDocument from 'pdfkit';
import bidiFactory from 'bidi-js';
import fs from 'node:fs';

const [, , fonts, out] = process.argv;
const bidi = bidiFactory();
const mm = (v) => (v * 72) / 25.4;
const SWAP = { '(': ')', ')': '(', '[': ']', ']': '[', '«': '»', '»': '«' };
const ARABIC_DIGITS = /^[٠-٩]+$/;

const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: 'certificate text probe' } });
doc.pipe(fs.createWriteStream(out));
doc.registerFont('name', `${fonts}/Amiri-Bold.ttf`);
doc.registerFont('brand', `${fonts}/ArefRuqaa-Bold.ttf`);
doc.registerFont('ui', `${fonts}/IBMPlexSansArabic-Regular.ttf`);
doc.registerFont('ui7', `${fonts}/IBMPlexSansArabic-Bold.ttf`);
const W = doc.page.width;

/** One centred visual line of a right-to-left paragraph. Returns its width in points. */
function line(text, font, size, y) {
  doc.font(font).fontSize(size);
  const { levels } = bidi.getEmbeddingLevels(text, 'rtl');
  const runs = [];
  for (let i = 0; i < text.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.level === levels[i]) last.text += text[i];
    else runs.push({ level: levels[i], text: text[i] });
  }
  for (const r of runs) {
    r.rtl = r.level % 2 === 1;
    if (r.rtl) r.text = [...r.text].map((ch) => SWAP[ch] ?? ch).join(''); // finding 4
    else if (ARABIC_DIGITS.test(r.text)) r.text = [...r.text].reverse().join(''); // finding 3
    r.opts = { lineBreak: false, features: r.rtl ? ['rtla'] : [] }; // finding 1
    r.width = doc.widthOfString(r.text, r.opts);
  }
  const total = runs.reduce((a, r) => a + r.width, 0);
  let x = (W + total) / 2; // finding 2: first logical run is the rightmost
  for (const r of runs) {
    x -= r.width;
    doc.text(r.text, x, y, r.opts);
  }
  return total;
}

line('شهادة إتمام', 'brand', 38, mm(20));
line('فاطمة الزهراء عبد الحسين محمد جواد كاظم عبد الأمير الخفاجي', 'name', 28, mm(50));
line('علي حسين عبد الله الشمّري', 'name', 44, mm(70));
line('دورة سيدة نساء العالمين (ع) التحقيقية الثانية', 'ui7', 19, mm(100));
line('أحكام التلاوة والتجويد · من ٣ أيار ٢٠٢٦ إلى ١٢ أيلول ٢٠٢٦', 'ui', 12.5, mm(115));
line('رقم الشهادة 00EX-AMP1 · noor-alawsiya.com/c/00EX-AMP1', 'ui', 12.5, mm(130));

// finding 5: widths at 100 pt, to compare with the browser (canvas measureText at 100 px, same font file)
doc.font('name').fontSize(100);
const widths = {
  'زينب حيدر كاظم': +doc.widthOfString('زينب حيدر كاظم', { features: ['rtla'] }).toFixed(1),
  'فاطمة الزهراء عبد الحسين محمد جواد كاظم عبد الأمير الخفاجي': +doc.widthOfString('فاطمة الزهراء عبد الحسين محمد جواد كاظم عبد الأمير الخفاجي', { features: ['rtla'] }).toFixed(1),
};
doc.end();
console.log(JSON.stringify(widths));
