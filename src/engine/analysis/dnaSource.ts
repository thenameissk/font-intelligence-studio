/**
 * Adapts a parsed font plus its edit overlay to the analyzer's input port.
 *
 * The analyzer deliberately does not know about opentype.js or the store,
 * which keeps it runnable inside a worker and easy to test with synthetic
 * outlines.
 */
import type { GlyphEdits } from '@/types/font'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import type { ParsedFont } from '@/engine/parser/parseFont'
import type { AnalysisGlyph, DnaSource } from './fontDna'

export function createDnaSource(
  parsed: ParsedFont,
  edits: GlyphEdits,
): DnaSource {
  const byCharCache = new Map<string, AnalysisGlyph | null>()

  const byChar = (char: string): AnalysisGlyph | null => {
    if (byCharCache.has(char)) return byCharCache.get(char) ?? null
    const codepoint = char.codePointAt(0)
    const glyphIndex =
      codepoint === undefined ? undefined : parsed.cmap.get(codepoint)
    let result: AnalysisGlyph | null = null
    if (glyphIndex !== undefined) {
      const glyph = resolveGlyph(parsed, edits, glyphIndex)
      result = {
        name: glyph.name,
        advanceWidth: glyph.advanceWidth,
        outline: glyph.outline,
        bounds: glyph.bounds,
        isEmpty: glyph.isEmpty,
      }
    }
    byCharCache.set(char, result)
    return result
  }

  return {
    unitsPerEm: parsed.verticalMetrics.unitsPerEm,
    declaredCapHeight: parsed.verticalMetrics.capHeight,
    declaredXHeight: parsed.verticalMetrics.xHeight,
    declaredAscender: parsed.verticalMetrics.ascender,
    declaredDescender: parsed.verticalMetrics.descender,
    declaredItalicAngle: parsed.verticalMetrics.italicAngle,
    declaredWeightClass: parsed.metadata.weightClass,
    declaredWidthClass: parsed.metadata.widthClass,
    byChar,

    advanceWidths: () =>
      parsed.glyphs
        .filter((g) => g.unicodes.length > 0)
        .map((g) => edits[g.index]?.advanceWidth ?? g.advanceWidth)
        .filter((w) => w > 0),

    glyphHeights: () => {
      const heights: number[] = []
      // Sampling keeps this bounded for very large fonts; the average glyph
      // height is a summary statistic, not a precise metric.
      const step = Math.max(1, Math.floor(parsed.glyphs.length / 400))
      for (let i = 0; i < parsed.glyphs.length; i += step) {
        const entry = parsed.index[i]
        if (!entry || entry.isEmpty) continue
        const glyph = resolveGlyph(parsed, edits, i)
        if (glyph.isEmpty) continue
        heights.push(glyph.bounds.yMax - glyph.bounds.yMin)
      }
      return heights
    },
  }
}
