/**
 * Measuring two glyphs against each other.
 *
 * Consistency work is comparative: a letter is not too wide in the abstract,
 * it is wider than the letters it sits next to. Two thumbnails side by side
 * show that something differs but never by how much, and the numbers that
 * settle it -- stem, overshoot, side bearings -- are exactly the ones nobody
 * can read off a picture.
 *
 * Every figure here is measured from the outlines themselves, so it reflects
 * pending edits rather than what the font shipped with.
 */
import type { Outline } from '@/types/geometry'
import type { VerticalMetrics } from '@/types/font'
import { countNodes, outlineBounds } from '@/engine/geometry/outline'
import { measureHorizontalStroke, measureVerticalStem } from './measure'

/**
 * The least a thing needs to be measurable.
 *
 * A variant offered by the font is an outline and an advance width, not a
 * resolved glyph, and so is a specimen borrowed from another typeface.
 * Measuring takes the shape, so that is all this asks for.
 */
export interface Measurable {
  outline: Outline
  advanceWidth: number
}

export interface GlyphMeasurements {
  advanceWidth: number
  leftSideBearing: number
  rightSideBearing: number
  width: number
  height: number
  yMin: number
  yMax: number
  /** Median vertical stem, or null when the shape has no readable stem. */
  stem: number | null
  /** Median horizontal stroke. */
  stroke: number | null
  /**
   * How far the shape passes the metric line it is drawn to. Round letters
   * are drawn slightly taller than flat ones so they look the same size, so
   * a zero overshoot on an `o` is a fault rather than a virtue.
   */
  overshootTop: number | null
  overshootBottom: number | null
  contours: number
  nodes: number
  /** Ink area as a fraction of the em square, a proxy for colour on the page. */
  inkRatio: number
}

export interface MeasurementRow {
  id: string
  label: string
  a: number | null
  b: number | null
  /** b - a, when both sides are readable. */
  delta: number | null
  /** Fractional difference, for sorting by significance. */
  relative: number | null
  unit: 'units' | 'percent' | 'count'
  /**
   * True when the two agree closely enough that the difference is not worth
   * a designer's attention.
   */
  matched: boolean
}

/** Area enclosed by an outline, via the shoelace formula over flattened runs. */
function outlineArea(outline: Outline): number {
  let total = 0
  for (const contour of outline.contours) {
    const points = contour.nodes
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]
      const q = points[(i + 1) % points.length]
      total += p.x * q.y - q.x * p.y
    }
  }
  return Math.abs(total) / 2
}

/**
 * The metric lines an overshoot can be measured against.
 *
 * Callers should pass the lines the editor is already drawing, which prefer
 * values measured from the outlines over the OS/2 fields. The fallback here
 * is deliberately thin because the OS/2 fields are so often missing: Arial
 * Black declares neither a cap height nor an x-height, and measuring its `o`
 * against the ascender would report an overshoot of -1168 units rather than
 * the 24 it is actually drawn with.
 */
export function defaultReferences(metrics: VerticalMetrics): number[] {
  return [metrics.xHeight, metrics.capHeight, metrics.ascender].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
}

/**
 * The line a letter is drawn to, chosen from where it actually sits rather
 * than from its name: a shape reaching cap height is measured against cap
 * height even when the character is unknown.
 */
function referenceTop(bounds: { yMax: number }, references: readonly number[]): number | null {
  const candidates = references.filter((value) => value > 0)
  if (candidates.length === 0) return null
  let best = candidates[0]
  for (const value of candidates) {
    if (Math.abs(bounds.yMax - value) < Math.abs(bounds.yMax - best)) best = value
  }
  return best
}

export function measureGlyph(
  glyph: Measurable,
  metrics: VerticalMetrics,
  references: readonly number[] = defaultReferences(metrics),
): GlyphMeasurements {
  const bounds = outlineBounds(glyph.outline)
  const upm = metrics.unitsPerEm
  const top = referenceTop(bounds, references)

  // A horizontal-stroke reading is the median height of the ink in each
  // column, which only means "stroke" when the letter has one. Scan an `n`
  // and most columns are full-height stem, so the median comes back as the
  // whole letter -- 1062 units on a 1086-unit tall glyph. That is not a
  // measurement of anything, so it is withheld rather than printed.
  const rawStroke = measureHorizontalStroke(glyph.outline)
  const inkHeight = bounds.yMax - bounds.yMin
  const stroke =
    rawStroke !== null && inkHeight > 0 && rawStroke > inkHeight * 0.6
      ? null
      : rawStroke

  return {
    advanceWidth: glyph.advanceWidth,
    // Derived rather than read, so a bare outline measures the same as a
    // resolved glyph does.
    leftSideBearing: bounds.xMin,
    rightSideBearing: glyph.advanceWidth - bounds.xMax,
    width: bounds.xMax - bounds.xMin,
    height: bounds.yMax - bounds.yMin,
    yMin: bounds.yMin,
    yMax: bounds.yMax,
    stem: measureVerticalStem(glyph.outline),
    stroke,
    overshootTop: top === null ? null : bounds.yMax - top,
    overshootBottom: bounds.yMin < 0 ? bounds.yMin : 0,
    contours: glyph.outline.contours.length,
    nodes: countNodes(glyph.outline),
    inkRatio: upm > 0 ? outlineArea(glyph.outline) / (upm * upm) : 0,
  }
}

/**
 * How close two readings must be to count as agreeing. Expressed against the
 * em so it holds at any upm, with a floor so that two values a single unit
 * apart never read as a difference worth chasing.
 */
function isMatched(a: number, b: number, upm: number): boolean {
  return Math.abs(b - a) <= Math.max(2, upm * 0.004)
}

export function compareGlyphs(
  a: Measurable,
  b: Measurable,
  metrics: VerticalMetrics,
  references: readonly number[] = defaultReferences(metrics),
): { a: GlyphMeasurements; b: GlyphMeasurements; rows: MeasurementRow[] } {
  const ma = measureGlyph(a, metrics, references)
  const mb = measureGlyph(b, metrics, references)
  const upm = metrics.unitsPerEm

  const row = (
    id: string,
    label: string,
    left: number | null,
    right: number | null,
    unit: MeasurementRow['unit'] = 'units',
  ): MeasurementRow => {
    const delta = left === null || right === null ? null : right - left
    const relative =
      delta === null || left === null || left === 0
        ? null
        : Math.abs(delta / left)
    return {
      id,
      label,
      a: left,
      b: right,
      delta,
      relative,
      unit,
      matched:
        left !== null &&
        right !== null &&
        (unit === 'count'
          ? left === right
          : isMatched(left, right, upm)),
    }
  }

  const rows: MeasurementRow[] = [
    row('advance', 'Advance', ma.advanceWidth, mb.advanceWidth),
    row('lsb', 'Left bearing', ma.leftSideBearing, mb.leftSideBearing),
    row('rsb', 'Right bearing', ma.rightSideBearing, mb.rightSideBearing),
    row('width', 'Ink width', ma.width, mb.width),
    row('height', 'Ink height', ma.height, mb.height),
    row('stem', 'Stem', ma.stem, mb.stem),
    row('stroke', 'Horizontal stroke', ma.stroke, mb.stroke),
    row('overshootTop', 'Overshoot above', ma.overshootTop, mb.overshootTop),
    row('overshootBottom', 'Below baseline', ma.overshootBottom, mb.overshootBottom),
    row('contours', 'Contours', ma.contours, mb.contours, 'count'),
    row('nodes', 'Nodes', ma.nodes, mb.nodes, 'count'),
  ]

  return { a: ma, b: mb, rows }
}

export const ALIGNMENT = {
  Origin: 'origin',
  Left: 'left',
  Centre: 'centre',
} as const
export type Alignment = (typeof ALIGNMENT)[keyof typeof ALIGNMENT]

/**
 * Horizontal shift that brings `b` into register with `a` for overlay.
 *
 * Overlaying at the origin answers "how do these sit in their own advance
 * widths"; overlaying on the ink answers "are these the same shape". Both
 * are real questions, and they have different answers, so the choice is the
 * viewer's rather than one baked in here.
 */
export function overlayOffset(
  a: Measurable,
  b: Measurable,
  alignment: Alignment,
): number {
  if (alignment === ALIGNMENT.Origin) return 0
  const ba = outlineBounds(a.outline)
  const bb = outlineBounds(b.outline)
  if (alignment === ALIGNMENT.Left) return ba.xMin - bb.xMin
  return (ba.xMin + ba.xMax) / 2 - (bb.xMin + bb.xMax) / 2
}
