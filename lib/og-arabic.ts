/**
 * Arabic for the per-course link card (app/courses/[slug]/og.png). Satori, the engine behind ImageResponse, measures a
 * word from its unjoined letters and then draws it joined, so every word is followed by a gap of a different size.
 * Here each letter is replaced by its joined form from Unicode's «Arabic Presentation Forms-B» block (IBM Plex Sans
 * Arabic has them all), so what Satori measures is exactly what it draws. Pure, no dependencies.
 */

// Base letter → first code point of its forms in FE70–FEFF: isolated, final, then initial, medial for dual-joining letters.
const DUAL: Record<string, number> = {
  'ئ': 0xfe89, 'ب': 0xfe8f, 'ت': 0xfe95, 'ث': 0xfe99, 'ج': 0xfe9d, 'ح': 0xfea1, 'خ': 0xfea5, 'س': 0xfeb1, 'ش': 0xfeb5,
  'ص': 0xfeb9, 'ض': 0xfebd, 'ط': 0xfec1, 'ظ': 0xfec5, 'ع': 0xfec9, 'غ': 0xfecd, 'ف': 0xfed1, 'ق': 0xfed5, 'ك': 0xfed9,
  'ل': 0xfedd, 'م': 0xfee1, 'ن': 0xfee5, 'ه': 0xfee9, 'ي': 0xfef1,
};
// Letters that join only to the letter before them (isolated, final).
const RIGHT: Record<string, number> = {
  'آ': 0xfe81, 'أ': 0xfe83, 'ؤ': 0xfe85, 'إ': 0xfe87, 'ا': 0xfe8d, 'ة': 0xfe93, 'د': 0xfea9, 'ذ': 0xfeab, 'ر': 0xfead,
  'ز': 0xfeaf, 'و': 0xfeed, 'ى': 0xfeef,
};
// Lam + alef ligatures (isolated, final).
const LAM_ALEF: Record<string, number> = { 'آ': 0xfef5, 'أ': 0xfef7, 'إ': 0xfef9, 'ا': 0xfefb };
const TATWEEL = 'ـ';
// Harakat, shadda, sukun, superscript alef: dropped on the card (the site's text keeps them).
const MARKS = /[ً-ٰٟ]/g;

const joinsForward = (ch: string | undefined) => ch !== undefined && (ch in DUAL || ch === TATWEEL);
const isLetter = (ch: string | undefined) => ch !== undefined && (ch in DUAL || ch in RIGHT || ch === TATWEEL);

/** Joined forms, still in logical (reading) order. Letters outside the table (and Latin, digits, punctuation) pass through. */
export function shapeArabic(text: string): string {
  const s = [...text.replace(MARKS, '')];
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const prev = s[i - 1];
    const joinPrev = joinsForward(prev) && isLetter(ch);
    if (ch === 'ل' && s[i + 1] in LAM_ALEF) {
      out += String.fromCodePoint(LAM_ALEF[s[i + 1]] + (joinPrev ? 1 : 0));
      i++;
      continue;
    }
    if (ch in DUAL) {
      const joinNext = isLetter(s[i + 1]);
      const form = joinPrev && joinNext ? 3 : joinNext ? 2 : joinPrev ? 1 : 0;
      out += String.fromCodePoint(DUAL[ch] + form);
    } else if (ch in RIGHT) {
      out += String.fromCodePoint(RIGHT[ch] + (joinPrev ? 1 : 0));
    } else if (ch === 'ء') {
      out += '\uFE80'; // hamza on the line never joins
    } else {
      out += ch;
    }
  }
  return out;
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '«': '»', '»': '«' };

/**
 * One word as Satori must draw it, left to right: joined forms, letters reversed, brackets mirrored, digit runs kept
 * in their own order. Words are then laid out right to left by the card itself (a row-reverse flex row).
 */
export function visualWord(word: string): string {
  const shaped = shapeArabic(word);
  const runs = shaped.match(/[0-9٠-٩]+|[^0-9٠-٩]/gu) ?? [];
  return runs
    .reverse()
    .map((r) => (r.length === 1 ? (MIRROR[r] ?? r) : r))
    .join('');
}

/** A line split into words for the card, each ready to draw. */
export const visualWords = (line: string) => line.split(/\s+/).filter(Boolean).map(visualWord);
