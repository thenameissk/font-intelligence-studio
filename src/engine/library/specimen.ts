/**
 * Pulling one letter out of a reference font, and saying what kind of letter
 * it is.
 *
 * The classification reuses the same measurements the analyzer applies to the
 * open font, so a face described as "double-storey, serif, bold" in the
 * library means exactly what those words mean everywhere else in the studio.
 */
import type { Outline } from '@/types/geometry'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { measureSerifRatio, measureSlant, median } from '@/engine/analysis/measure'
import {
  analyzeGlyphStructure,
  constructionLabel,
  CONSTRUCTION,
  type Construction,
} from '@/engine/analysis/glyphStructure'
import { nearestWeightName, WIDTH_CLASS_NAMES } from '@/engine/analysis/classification'
import type { LibraryEntry } from './libraryDb'
import { currentLibraryBackend } from '@/store/sessionStore'

export interface Specimen {
  fontId: string
  family: string
  style: string
  /** The letter itself, in the reference font's own units. */
  outline: Outline
  advanceWidth: number
  unitsPerEm: number
  /** For placing it on a shared baseline when displaying. */
  ascender: number
  descender: number
  xHeight: number | null
  capHeight: number | null
  construction: Construction
  /** 'Serif' | 'Slab / flared' | 'Sans serif' | 'Unknown' */
  serif: string
  weightName: string
  widthName: string | null
  isItalic: boolean
  /** Short human summary, e.g. "Double-storey · Serif · Bold". */
  label: string
}

/**
 * Parsed reference fonts, kept in memory.
 *
 * Parsing is fast but not free, and the variant grid asks the same fonts for
 * a new character every time the selection changes. The cache is bounded
 * because a library of large fonts held open would be tens of megabytes.
 */
const MAX_CACHED = 14
const cache = new Map<string, ParsedFont>()

function remember(id: string, parsed: ParsedFont): void {
  cache.delete(id)
  cache.set(id, parsed)
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export async function loadLibraryParsed(id: string): Promise<ParsedFont | null> {
  const cached = cache.get(id)
  if (cached) {
    remember(id, cached)
    return cached
  }
  const bytes = await currentLibraryBackend().bytes(id)
  if (!bytes) return null
  try {
    const parsed = await parseFontFile({
      name: `library-${id}`,
      buffer: bytes.slice(0),
    })
    remember(id, parsed)
    return parsed
  } catch {
    return null
  }
}

export function clearSpecimenCache(): void {
  cache.clear()
}

/**
 * Slant, read from a single upright stem.
 *
 * The same glyphs the font analyzer uses, and for the same reason: they are
 * the only ones whose edge is a straight vertical.
 */
function measureStemSlant(parsed: ParsedFont): number | null {
  for (const char of ['I', 'l', 'H', 'i']) {
    const index = parsed.cmap.get(char.codePointAt(0)!)
    if (index === undefined) continue
    const glyph = resolveGlyph(parsed, {}, index)
    if (glyph.isEmpty) continue
    const slant = measureSlant(glyph.outline)
    if (slant !== null) return slant
  }
  return null
}

/** Serif reading, sampled across several stems as the analyzer does. */
function readSerif(parsed: ParsedFont): string {
  const ratios: number[] = []
  for (const char of ['H', 'l', 'n', 'I', 'i', 'E']) {
    const index = parsed.cmap.get(char.codePointAt(0)!)
    if (index === undefined) continue
    const glyph = resolveGlyph(parsed, {}, index)
    if (glyph.isEmpty) continue
    const ratio = measureSerifRatio(glyph.outline)
    if (ratio !== null && Number.isFinite(ratio)) ratios.push(ratio)
  }
  const ratio = median(ratios)
  if (ratio === null) return 'Unknown'
  return ratio > 1.4 ? 'Serif' : ratio > 1.12 ? 'Slab / flared' : 'Sans serif'
}

export function buildLabel(input: {
  construction: Construction
  serif: string
  weightName: string
  widthName: string | null
  isItalic: boolean
}): string {
  const parts: string[] = []
  if (input.construction !== CONSTRUCTION.Unknown) {
    parts.push(constructionLabel(input.construction))
  }
  if (input.serif !== 'Unknown') parts.push(input.serif)
  if (input.weightName !== 'Regular') parts.push(input.weightName)
  if (input.widthName && input.widthName !== 'Normal') parts.push(input.widthName)
  if (input.isItalic) parts.push('Italic')
  return parts.join(' · ') || 'Unclassified'
}

export async function extractSpecimen(
  entry: LibraryEntry,
  codepoint: number,
): Promise<Specimen | null> {
  const parsed = await loadLibraryParsed(entry.id)
  if (!parsed) return null

  const index = parsed.cmap.get(codepoint)
  if (index === undefined) return null

  const glyph = resolveGlyph(parsed, {}, index)
  if (glyph.isEmpty) return null

  const char = String.fromCodePoint(codepoint)
  const structure = analyzeGlyphStructure(glyph.outline, { char })
  const serif = readSerif(parsed)

  // Italic is worth reading from the drawing as well as the flag, since
  // plenty of faces slant without setting the bit. The reading has to come
  // from a plain stem, though: measured on a letter with curves and several
  // stems it is worthless -- Optima's 'a' reads 43 degrees and Georgia's 'n'
  // reads minus 44, both of them bolt upright.
  const slant = measureStemSlant(parsed)
  const isItalic =
    entry.isItalic ||
    parsed.verticalMetrics.italicAngle < -2 ||
    (slant !== null && slant > 6)

  const weightName = nearestWeightName(entry.weightClass ?? 400)
  const widthName =
    entry.widthClass !== null ? (WIDTH_CLASS_NAMES[entry.widthClass] ?? null) : null

  return {
    fontId: entry.id,
    family: entry.family,
    style: entry.style,
    outline: glyph.outline,
    advanceWidth: glyph.advanceWidth,
    unitsPerEm: parsed.verticalMetrics.unitsPerEm,
    ascender: parsed.verticalMetrics.ascender,
    descender: parsed.verticalMetrics.descender,
    xHeight: parsed.verticalMetrics.xHeight,
    capHeight: parsed.verticalMetrics.capHeight,
    construction: structure.construction,
    serif,
    weightName,
    widthName,
    isItalic,
    label: buildLabel({
      construction: structure.construction,
      serif,
      weightName,
      widthName,
      isItalic,
    }),
  }
}

/** Groups specimens the way the difference is usually explained. */
export function groupByConstruction(
  specimens: readonly Specimen[],
): Array<{ construction: Construction; label: string; specimens: Specimen[] }> {
  const groups = new Map<Construction, Specimen[]>()
  for (const specimen of specimens) {
    const list = groups.get(specimen.construction)
    if (list) list.push(specimen)
    else groups.set(specimen.construction, [specimen])
  }

  const order: Construction[] = [
    CONSTRUCTION.TwoStorey,
    CONSTRUCTION.OneStorey,
    CONSTRUCTION.DoubleStorey,
    CONSTRUCTION.DoubleStoreyOpen,
    CONSTRUCTION.SingleStorey,
    CONSTRUCTION.Unknown,
  ]

  return order
    .filter((construction) => groups.has(construction))
    .map((construction) => ({
      construction,
      label:
        construction === CONSTRUCTION.Unknown
          ? 'Other typefaces'
          : constructionLabel(construction),
      specimens: groups.get(construction)!,
    }))
}
