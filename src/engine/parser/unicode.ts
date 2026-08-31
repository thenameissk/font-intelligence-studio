/**
 * Unicode classification used by the glyph browser and the QA engine.
 *
 * Categories are deliberately design-tool shaped rather than strictly
 * Unicode-spec shaped: a designer looking for "Uppercase" means A-Z, and
 * expects accented capitals under "Latin Extended".
 */
import { GLYPH_CATEGORY, type GlyphCategory } from '@/types/font'

type Range = readonly [number, number]

const inRanges = (cp: number, ranges: readonly Range[]): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi)

const CURRENCY: readonly Range[] = [
  [0x0024, 0x0024],
  [0x00a2, 0x00a5],
  [0x058f, 0x058f],
  [0x060b, 0x060b],
  [0x09f2, 0x09f3],
  [0x0af1, 0x0af1],
  [0x0bf9, 0x0bf9],
  [0x0e3f, 0x0e3f],
  [0x17db, 0x17db],
  [0x20a0, 0x20c0],
  [0xa838, 0xa838],
  [0xfdfc, 0xfdfc],
  [0xfe69, 0xfe69],
  [0xff04, 0xff04],
  [0xffe0, 0xffe1],
  [0xffe5, 0xffe6],
]

const ARROWS: readonly Range[] = [
  [0x2190, 0x21ff],
  [0x27f0, 0x27ff],
  [0x2900, 0x297f],
  [0x2b00, 0x2b11],
  [0x2b30, 0x2b4f],
]

const MATHEMATICAL: readonly Range[] = [
  [0x002b, 0x002b],
  [0x003c, 0x003e],
  [0x005e, 0x005e],
  [0x007c, 0x007c],
  [0x007e, 0x007e],
  [0x00ac, 0x00ac],
  [0x00b1, 0x00b1],
  [0x00d7, 0x00d7],
  [0x00f7, 0x00f7],
  [0x2044, 0x2044],
  [0x2052, 0x2052],
  [0x2200, 0x22ff],
  [0x2308, 0x230b],
  [0x2320, 0x2321],
  [0x237c, 0x237c],
  [0x239b, 0x23b5],
  [0x25b7, 0x25b7],
  [0x27c0, 0x27ef],
  [0x2980, 0x2aff],
  [0x1d400, 0x1d7ff],
]

const NUMBERS: readonly Range[] = [
  [0x0030, 0x0039],
  [0x00b2, 0x00b3],
  [0x00b9, 0x00b9],
  [0x00bc, 0x00be],
  [0x2070, 0x209f],
  [0x2150, 0x218f],
  [0x2460, 0x249b],
  [0xff10, 0xff19],
]

const PUNCTUATION: readonly Range[] = [
  [0x0021, 0x0023],
  [0x0025, 0x002a],
  [0x002c, 0x002f],
  [0x003a, 0x003b],
  [0x003f, 0x0040],
  [0x005b, 0x005d],
  [0x005f, 0x005f],
  [0x007b, 0x007b],
  [0x007d, 0x007d],
  [0x00a1, 0x00a1],
  [0x00ab, 0x00ab],
  [0x00b6, 0x00b7],
  [0x00bb, 0x00bb],
  [0x00bf, 0x00bf],
  [0x2010, 0x205e],
  [0x2e00, 0x2e7f],
  [0x3001, 0x3003],
]

const GREEK: readonly Range[] = [
  [0x0370, 0x03ff],
  [0x1f00, 0x1fff],
]

const CYRILLIC: readonly Range[] = [
  [0x0400, 0x052f],
  [0x2de0, 0x2dff],
  [0xa640, 0xa69f],
]

const MARKS: readonly Range[] = [
  [0x02b0, 0x02ff],
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20f0],
  [0xfe20, 0xfe2f],
]

const LATIN_EXTENDED: readonly Range[] = [
  [0x00c0, 0x00ff],
  [0x0100, 0x024f],
  [0x1e00, 0x1eff],
  [0x2c60, 0x2c7f],
  [0xa720, 0xa7ff],
  [0xab30, 0xab6f],
  [0xfb00, 0xfb06],
]

const SYMBOLS: readonly Range[] = [
  [0x00a6, 0x00a9],
  [0x00ae, 0x00b0],
  [0x00b4, 0x00b5],
  [0x00b8, 0x00b8],
  [0x2100, 0x214f],
  [0x2300, 0x23ff],
  [0x2500, 0x2bff],
  [0x1f000, 0x1faff],
]

export function categorizeCodepoint(cp: number | null): GlyphCategory {
  if (cp === null) return GLYPH_CATEGORY.Unencoded
  if (cp >= 0x0041 && cp <= 0x005a) return GLYPH_CATEGORY.Uppercase
  if (cp >= 0x0061 && cp <= 0x007a) return GLYPH_CATEGORY.Lowercase
  if (inRanges(cp, CURRENCY)) return GLYPH_CATEGORY.Currency
  if (inRanges(cp, NUMBERS)) return GLYPH_CATEGORY.Numbers
  if (inRanges(cp, ARROWS)) return GLYPH_CATEGORY.Arrows
  if (inRanges(cp, MATHEMATICAL)) return GLYPH_CATEGORY.Mathematical
  if (inRanges(cp, PUNCTUATION)) return GLYPH_CATEGORY.Punctuation
  if (inRanges(cp, MARKS)) return GLYPH_CATEGORY.Marks
  if (inRanges(cp, GREEK)) return GLYPH_CATEGORY.Greek
  if (inRanges(cp, CYRILLIC)) return GLYPH_CATEGORY.Cyrillic
  if (inRanges(cp, LATIN_EXTENDED)) return GLYPH_CATEGORY.LatinExtended
  if (inRanges(cp, SYMBOLS)) return GLYPH_CATEGORY.Symbols
  return GLYPH_CATEGORY.Other
}

/** Combining marks need a dotted circle to be legible on their own. */
export function isCombiningMark(cp: number): boolean {
  return inRanges(cp, [
    [0x0300, 0x036f],
    [0x1ab0, 0x1aff],
    [0x1dc0, 0x1dff],
    [0x20d0, 0x20f0],
    [0xfe20, 0xfe2f],
  ])
}

export function isControlOrFormat(cp: number): boolean {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0xa0) ||
    cp === 0x00ad ||
    (cp >= 0x2000 && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202f) ||
    (cp >= 0x205f && cp <= 0x206f) ||
    (cp >= 0xfff9 && cp <= 0xfffb) ||
    cp === 0xfeff
  )
}

/** A displayable string for a code point, or null when it has no glyph form. */
export function codepointToDisplayChar(cp: number | null): string | null {
  if (cp === null) return null
  if (isControlOrFormat(cp)) return null
  const ch = String.fromCodePoint(cp)
  return isCombiningMark(cp) ? `◌${ch}` : ch
}

export function formatCodepoint(cp: number | null): string {
  if (cp === null) return '—'
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

interface Block {
  name: string
  range: Range
}

const BLOCKS: readonly Block[] = [
  { name: 'Basic Latin', range: [0x0000, 0x007f] },
  { name: 'Latin-1 Supplement', range: [0x0080, 0x00ff] },
  { name: 'Latin Extended-A', range: [0x0100, 0x017f] },
  { name: 'Latin Extended-B', range: [0x0180, 0x024f] },
  { name: 'IPA Extensions', range: [0x0250, 0x02af] },
  { name: 'Spacing Modifier Letters', range: [0x02b0, 0x02ff] },
  { name: 'Combining Diacritical Marks', range: [0x0300, 0x036f] },
  { name: 'Greek and Coptic', range: [0x0370, 0x03ff] },
  { name: 'Cyrillic', range: [0x0400, 0x04ff] },
  { name: 'Cyrillic Supplement', range: [0x0500, 0x052f] },
  { name: 'Armenian', range: [0x0530, 0x058f] },
  { name: 'Hebrew', range: [0x0590, 0x05ff] },
  { name: 'Arabic', range: [0x0600, 0x06ff] },
  { name: 'Devanagari', range: [0x0900, 0x097f] },
  { name: 'Thai', range: [0x0e00, 0x0e7f] },
  { name: 'Latin Extended Additional', range: [0x1e00, 0x1eff] },
  { name: 'Greek Extended', range: [0x1f00, 0x1fff] },
  { name: 'General Punctuation', range: [0x2000, 0x206f] },
  { name: 'Superscripts and Subscripts', range: [0x2070, 0x209f] },
  { name: 'Currency Symbols', range: [0x20a0, 0x20cf] },
  { name: 'Combining Marks for Symbols', range: [0x20d0, 0x20ff] },
  { name: 'Letterlike Symbols', range: [0x2100, 0x214f] },
  { name: 'Number Forms', range: [0x2150, 0x218f] },
  { name: 'Arrows', range: [0x2190, 0x21ff] },
  { name: 'Mathematical Operators', range: [0x2200, 0x22ff] },
  { name: 'Miscellaneous Technical', range: [0x2300, 0x23ff] },
  { name: 'Box Drawing', range: [0x2500, 0x257f] },
  { name: 'Geometric Shapes', range: [0x25a0, 0x25ff] },
  { name: 'Miscellaneous Symbols', range: [0x2600, 0x26ff] },
  { name: 'Dingbats', range: [0x2700, 0x27bf] },
  { name: 'Supplemental Math Operators', range: [0x2a00, 0x2aff] },
  { name: 'CJK Symbols and Punctuation', range: [0x3000, 0x303f] },
  { name: 'Hiragana', range: [0x3040, 0x309f] },
  { name: 'Katakana', range: [0x30a0, 0x30ff] },
  { name: 'CJK Unified Ideographs', range: [0x4e00, 0x9fff] },
  { name: 'Latin Extended-D', range: [0xa720, 0xa7ff] },
  { name: 'Alphabetic Presentation Forms', range: [0xfb00, 0xfb4f] },
  { name: 'Halfwidth and Fullwidth Forms', range: [0xff00, 0xffef] },
  { name: 'Mathematical Alphanumeric Symbols', range: [0x1d400, 0x1d7ff] },
  { name: 'Emoticons', range: [0x1f600, 0x1f64f] },
]

export function unicodeBlockName(cp: number | null): string {
  if (cp === null) return 'Unencoded'
  const block = BLOCKS.find(
    (b) => cp >= b.range[0] && cp <= b.range[1],
  )
  return block ? block.name : 'Unassigned block'
}

/**
 * Code points a Latin text font is normally expected to cover. Used by the
 * QA engine to report missing recommended glyphs.
 */
export const RECOMMENDED_CODEPOINTS: readonly number[] = [
  ...range(0x0020, 0x007e),
  0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a5, 0x00a7, 0x00a9, 0x00ab, 0x00ae,
  0x00b0, 0x00b1, 0x00b7, 0x00bb, 0x00bf,
  ...range(0x00c0, 0x00ff),
  0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e, 0x0192,
  0x02c6, 0x02dc,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e,
  0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a,
  0x20ac, 0x2122, 0x2212,
]

function range(lo: number, hi: number): number[] {
  const out: number[] = []
  for (let i = lo; i <= hi; i += 1) out.push(i)
  return out
}
