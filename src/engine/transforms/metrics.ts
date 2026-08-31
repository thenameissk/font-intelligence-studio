/**
 * Metric editing.
 *
 * Side bearings are not stored anywhere in the font -- they are consequences
 * of the outline and the advance width. So setting a left side bearing
 * translates the outline, and setting a right side bearing changes the
 * advance width. That is how every type editor behaves, and it keeps the
 * model free of a redundant, drift-prone stored LSB.
 */
import type { GlyphEdit, ResolvedGlyph } from '@/types/font'
import { transformOutline, translation } from '@/engine/geometry/transform'

export function setAdvanceWidth(
  glyph: ResolvedGlyph,
  advanceWidth: number,
): GlyphEdit {
  return {
    outline: glyph.outline,
    advanceWidth: Math.max(0, Math.round(advanceWidth)),
  }
}

export function setLeftSideBearing(
  glyph: ResolvedGlyph,
  leftSideBearing: number,
): GlyphEdit {
  if (glyph.isEmpty) return { outline: glyph.outline, advanceWidth: glyph.advanceWidth }
  const delta = leftSideBearing - glyph.bounds.xMin
  return {
    outline: transformOutline(glyph.outline, translation(delta, 0)),
    advanceWidth: glyph.advanceWidth,
  }
}

/**
 * Keeps the outline where it is and moves the advance width, which is what
 * "set the right side bearing" means.
 */
export function setRightSideBearing(
  glyph: ResolvedGlyph,
  rightSideBearing: number,
): GlyphEdit {
  if (glyph.isEmpty) return { outline: glyph.outline, advanceWidth: glyph.advanceWidth }
  return {
    outline: glyph.outline,
    advanceWidth: Math.max(0, Math.round(glyph.bounds.xMax + rightSideBearing)),
  }
}

/** Moves the outline vertically without touching the advance width. */
export function shiftVertically(glyph: ResolvedGlyph, dy: number): GlyphEdit {
  return {
    outline: transformOutline(glyph.outline, translation(0, dy)),
    advanceWidth: glyph.advanceWidth,
  }
}

/** Sets both side bearings at once, centring the glyph in its advance. */
export function setSideBearings(
  glyph: ResolvedGlyph,
  left: number,
  right: number,
): GlyphEdit {
  if (glyph.isEmpty) {
    return {
      outline: glyph.outline,
      advanceWidth: Math.max(0, Math.round(left + right)),
    }
  }
  const width = glyph.bounds.xMax - glyph.bounds.xMin
  return {
    outline: transformOutline(
      glyph.outline,
      translation(left - glyph.bounds.xMin, 0),
    ),
    advanceWidth: Math.max(0, Math.round(left + width + right)),
  }
}
