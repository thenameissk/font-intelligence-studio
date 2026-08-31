/**
 * Resolves a glyph by layering the edit overlay on top of the imported font.
 *
 * Resolution is memoised per (glyph index, edit object identity). Because
 * edits are stored immutably, an unchanged glyph keeps the same `GlyphEdit`
 * reference and the cache stays valid.
 */
import type { GlyphEdit, GlyphEdits, ResolvedGlyph } from '@/types/font'
import type { GlyphComponent, Outline, Rect } from '@/types/geometry'
import { EMPTY_RECT, isOutlineEmpty, outlineBounds } from '@/engine/geometry/outline'
import type { ParsedFont } from './parseFont'

interface CacheEntry {
  edit: GlyphEdit | undefined
  glyph: ResolvedGlyph
}

const caches = new WeakMap<ParsedFont, Map<number, CacheEntry>>()

function cacheFor(parsed: ParsedFont): Map<number, CacheEntry> {
  let cache = caches.get(parsed)
  if (!cache) {
    cache = new Map()
    caches.set(parsed, cache)
  }
  return cache
}

function readComponents(
  parsed: ParsedFont,
  glyphIndex: number,
): GlyphComponent[] {
  try {
    const glyph = parsed.otFont.glyphs.get(glyphIndex)
    if (!Array.isArray(glyph.components)) return []
    return glyph.components.map((component) => ({
      glyphIndex: component.glyphIndex,
      transform: [
        component.xScale ?? 1,
        component.scale01 ?? 0,
        component.scale10 ?? 0,
        component.yScale ?? 1,
        component.dx ?? 0,
        component.dy ?? 0,
      ] as const,
    }))
  } catch {
    return []
  }
}

function boundsOf(outline: Outline): Rect {
  return isOutlineEmpty(outline) ? EMPTY_RECT : outlineBounds(outline)
}

export function resolveGlyph(
  parsed: ParsedFont,
  edits: GlyphEdits,
  glyphIndex: number,
): ResolvedGlyph {
  const cache = cacheFor(parsed)
  const edit = edits[glyphIndex]
  const cached = cache.get(glyphIndex)
  if (cached && cached.edit === edit) return cached.glyph

  const source = parsed.glyphs[glyphIndex]
  if (!source) {
    throw new Error(`Glyph index ${glyphIndex} is out of range.`)
  }

  const outline = edit?.outline ?? parsed.sourceOutline(glyphIndex)
  const advanceWidth = edit?.advanceWidth ?? source.advanceWidth
  const bounds = boundsOf(outline)
  const empty = isOutlineEmpty(outline)

  const glyph: ResolvedGlyph = {
    index: glyphIndex,
    name: source.name,
    unicode: source.unicode,
    unicodes: source.unicodes,
    advanceWidth,
    outline,
    components: edit?.outline ? [] : readComponents(parsed, glyphIndex),
    bounds,
    leftSideBearing: empty ? 0 : bounds.xMin,
    rightSideBearing: empty ? advanceWidth : advanceWidth - bounds.xMax,
    isComposite: source.isComposite && !edit?.outline,
    isEmpty: empty,
    modified: edit !== undefined,
  }

  cache.set(glyphIndex, { edit, glyph })
  return glyph
}

/** Resolved outline without the rest of the glyph record. */
export function resolveOutline(
  parsed: ParsedFont,
  edits: GlyphEdits,
  glyphIndex: number,
): Outline {
  return edits[glyphIndex]?.outline ?? parsed.sourceOutline(glyphIndex)
}

export function resolveAdvanceWidth(
  parsed: ParsedFont,
  edits: GlyphEdits,
  glyphIndex: number,
): number {
  return edits[glyphIndex]?.advanceWidth ?? parsed.glyphs[glyphIndex]?.advanceWidth ?? 0
}

export function glyphIndexForCodepoint(
  parsed: ParsedFont,
  codepoint: number,
): number | null {
  return parsed.cmap.get(codepoint) ?? null
}

export function glyphIndexForChar(
  parsed: ParsedFont,
  char: string,
): number | null {
  const codepoint = char.codePointAt(0)
  return codepoint === undefined ? null : glyphIndexForCodepoint(parsed, codepoint)
}
