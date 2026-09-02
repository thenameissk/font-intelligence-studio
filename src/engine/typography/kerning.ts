/**
 * Kerning: reading what the font already has, and layering user overrides.
 *
 * Values come from whichever table the font uses -- a legacy `kern` table or
 * a GPOS pair-positioning lookup -- via the parser, so both are respected.
 * Overrides live in the document as a sparse map keyed by glyph index pair.
 */
import type { ParsedFont } from '@/engine/parser/parseFont'

export interface KernPair {
  left: number
  right: number
  leftChar: string
  rightChar: string
  /** The value in the imported font. */
  original: number
  /** The value in effect now, including any override. */
  current: number
  modified: boolean
}

export function pairKey(left: number, right: number): string {
  return `${left},${right}`
}

/**
 * Pairs that need attention in almost every Latin text face: open shapes
 * against diagonals, and anything followed by a full stop or comma.
 */
export const COMMON_PAIRS: string[] = [
  'AV', 'AT', 'AW', 'AY', 'Av', 'Aw', 'Ay',
  'FA', 'F.', 'F,',
  'LT', 'LV', 'LW', 'LY', 'L‘',
  'PA', 'P.', 'P,',
  'TA', 'Ta', 'Te', 'To', 'Tr', 'Tu', 'Tw', 'Ty', 'T.', 'T,', 'T-',
  'VA', 'Va', 'Ve', 'Vo', 'Vu', 'V.', 'V,',
  'WA', 'Wa', 'We', 'Wo', 'W.', 'W,',
  'YA', 'Ya', 'Ye', 'Yo', 'Yu', 'Y.', 'Y,',
  'ra', 'rd', 're', 'ro', 'rt', 'ry', 'r.', 'r,',
  'av', 'aw', 'ay', 'ff', 'fi', 'fl',
  'v.', 'v,', 'w.', 'w,', 'y.', 'y,',
  'Th', 'Wh', 'yo', 'oy',
  '11', '17', '71', '74', '47',
  '“A', 'A”', '(j', 'f)',
]

function glyphIndexFor(parsed: ParsedFont, char: string): number | null {
  const codepoint = char.codePointAt(0)
  return codepoint === undefined ? null : (parsed.cmap.get(codepoint) ?? null)
}

/**
 * The font's own kerning for a pair.
 *
 * Read from `kerningPairs` first, and only then from `getKerningValue`.
 * That order matters. `getKerningValue` resolves GPOS through
 * `getKerningTables(script, language)`, which asks for one script and one
 * language and returns nothing when the font files its kerning under a tag
 * the caller did not guess -- so a face whose pairs live under `latn` while
 * the default lookup asks for `DFLT` reports every pair as zero. Arial
 * Black is exactly that font: 392 non-zero pairs in `kerningPairs`, and
 * `getKerningValue` answers 0 for every one of them, including AV at -113.
 *
 * `kerningPairs` is built once at parse time from whichever table the font
 * actually uses -- legacy `kern` or GPOS -- so it does not depend on
 * guessing a script tag. `getKerningValue` is kept as the fallback for the
 * fonts whose pairs it does reach.
 */
export function originalKerning(
  parsed: ParsedFont,
  left: number,
  right: number,
): number {
  const direct = parsed.otFont.kerningPairs?.[pairKey(left, right)]
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct

  try {
    const value = parsed.otFont.getKerningValue(left, right)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

export function effectiveKerning(
  parsed: ParsedFont,
  kerningEdits: Readonly<Record<string, number>>,
  left: number,
  right: number,
): number {
  const override = kerningEdits[pairKey(left, right)]
  return override !== undefined ? override : originalKerning(parsed, left, right)
}

export function buildPair(
  parsed: ParsedFont,
  kerningEdits: Readonly<Record<string, number>>,
  leftChar: string,
  rightChar: string,
): KernPair | null {
  const left = glyphIndexFor(parsed, leftChar)
  const right = glyphIndexFor(parsed, rightChar)
  if (left === null || right === null) return null

  const original = originalKerning(parsed, left, right)
  const override = kerningEdits[pairKey(left, right)]
  return {
    left,
    right,
    leftChar,
    rightChar,
    original,
    current: override !== undefined ? override : original,
    modified: override !== undefined,
  }
}

export interface PairListOptions {
  /** Include pairs that the font already kerns. */
  includeExisting?: boolean
  /** Only pairs whose effective value is non-zero. */
  onlyKerned?: boolean
  limit?: number
}

/**
 * The working set of pairs for the editor: the common trouble spots this
 * font can render, plus pairs it already kerns, plus anything the user has
 * overridden.
 */
export function collectPairs(
  parsed: ParsedFont,
  kerningEdits: Readonly<Record<string, number>>,
  options: PairListOptions = {},
): KernPair[] {
  const seen = new Set<string>()
  const pairs: KernPair[] = []

  const add = (pair: KernPair | null): void => {
    if (!pair) return
    const key = pairKey(pair.left, pair.right)
    if (seen.has(key)) return
    seen.add(key)
    pairs.push(pair)
  }

  for (const text of COMMON_PAIRS) {
    const chars = [...text]
    if (chars.length !== 2) continue
    add(buildPair(parsed, kerningEdits, chars[0], chars[1]))
  }

  if (options.includeExisting !== false) {
    // The legacy kern table is enumerable; GPOS lookups are not, so those
    // pairs surface through the common list and by typing a pair in.
    const existing = parsed.otFont.kerningPairs ?? {}
    const limit = options.limit ?? 400
    for (const key of Object.keys(existing)) {
      if (pairs.length >= limit) break
      const [left, right] = key.split(',').map(Number)
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue
      if (seen.has(pairKey(left, right))) continue
      const leftChar = charFor(parsed, left)
      const rightChar = charFor(parsed, right)
      if (leftChar === null || rightChar === null) continue
      add(buildPair(parsed, kerningEdits, leftChar, rightChar))
    }
  }

  // Anything the user changed must always be visible, even if it is not a
  // common pair and not in the font's own table.
  for (const key of Object.keys(kerningEdits)) {
    const [left, right] = key.split(',').map(Number)
    if (seen.has(pairKey(left, right))) continue
    const leftChar = charFor(parsed, left)
    const rightChar = charFor(parsed, right)
    if (leftChar === null || rightChar === null) continue
    add(buildPair(parsed, kerningEdits, leftChar, rightChar))
  }

  return options.onlyKerned
    ? pairs.filter((pair) => pair.current !== 0 || pair.modified)
    : pairs
}

function charFor(parsed: ParsedFont, glyphIndex: number): string | null {
  const unicode = parsed.glyphs[glyphIndex]?.unicode
  return unicode === null || unicode === undefined
    ? null
    : String.fromCodePoint(unicode)
}

/** Merged kerning for export: the font's own pairs with overrides applied. */
export function mergedKerningPairs(
  parsed: ParsedFont,
  kerningEdits: Readonly<Record<string, number>>,
): Array<{ left: number; right: number; value: number }> {
  const merged = new Map<string, { left: number; right: number; value: number }>()

  const existing = parsed.otFont.kerningPairs ?? {}
  for (const key of Object.keys(existing)) {
    const [left, right] = key.split(',').map(Number)
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue
    const value = existing[key]
    if (value === 0) continue
    merged.set(pairKey(left, right), { left, right, value })
  }

  for (const [key, value] of Object.entries(kerningEdits)) {
    const [left, right] = key.split(',').map(Number)
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue
    if (value === 0) merged.delete(key)
    else merged.set(key, { left, right, value })
  }

  return [...merged.values()].sort(
    (a, b) => a.left - b.left || a.right - b.right,
  )
}
