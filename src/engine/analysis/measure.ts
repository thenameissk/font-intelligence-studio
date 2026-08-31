/**
 * Outline measurement primitives used by the Font DNA analyzer.
 *
 * Everything here works on real vector geometry via scanline intersection.
 * No rasterisation, and no reliance on the font's own declared metrics.
 */
import type { Outline, Point, Rect } from '@/types/geometry'
import {
  contourSegments,
  nodePoint,
  outlineBounds,
} from '@/engine/geometry/outline'
import {
  horizontalCrossings,
  inkRunsAtX,
  inkRunsAtY,
} from '@/engine/geometry/intersect'
import {
  about,
  rotation,
  transformOutline,
} from '@/engine/geometry/transform'
import { cubicCurvatureAt } from '@/engine/geometry/bezier'

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function standardDeviation(values: number[]): number | null {
  const m = mean(values)
  if (m === null || values.length < 2) return null
  const variance =
    values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * Median width of the vertical strokes in a glyph.
 *
 * Sampling many heights and taking the median makes the result robust to
 * crossbars, joins and serifs, which only affect a minority of scanlines.
 */
export function measureVerticalStem(
  outline: Outline,
  options: { from?: number; to?: number; samples?: number } = {},
): number | null {
  const bounds = outlineBounds(outline)
  const height = bounds.yMax - bounds.yMin
  if (height <= 0) return null

  const from = options.from ?? bounds.yMin + height * 0.15
  const to = options.to ?? bounds.yMin + height * 0.85
  const samples = options.samples ?? 25

  const widths: number[] = []
  for (let i = 0; i < samples; i += 1) {
    const y = from + ((to - from) * i) / Math.max(1, samples - 1)
    for (const run of inkRunsAtY(outline, y)) widths.push(run.width)
  }
  return median(widths)
}

/** Median height of the horizontal strokes, sampled across the width. */
export function measureHorizontalStroke(
  outline: Outline,
  options: { samples?: number } = {},
): number | null {
  const bounds = outlineBounds(outline)
  const width = bounds.xMax - bounds.xMin
  if (width <= 0) return null

  const samples = options.samples ?? 25
  const from = bounds.xMin + width * 0.15
  const to = bounds.xMax - width * 0.15

  const heights: number[] = []
  for (let i = 0; i < samples; i += 1) {
    const x = from + ((to - from) * i) / Math.max(1, samples - 1)
    for (const run of inkRunsAtX(outline, x)) heights.push(run.width)
  }
  return median(heights)
}

/**
 * Thickness of a ring glyph ('O', 'o') along a given angle, measured from
 * the centre outwards. Rotating the outline lets us reuse the horizontal
 * scanline for any angle.
 *
 * Validity is decided by the crossing count: walking outwards from the
 * centre of a ring must cross the counter edge and then the outer edge,
 * exactly twice. A ray that grazes the counter tangentially crosses fewer
 * times and would otherwise report the counter and the stroke as one very
 * thick stroke, so those samples are rejected rather than clamped.
 */
export function measureRingThickness(
  outline: Outline,
  center: Point,
  angleDegrees: number,
): number | null {
  const rotated =
    angleDegrees === 0
      ? outline
      : transformOutline(outline, about(rotation(-angleDegrees), center))
  const crossings = horizontalCrossings(rotated, center.y)

  const right = crossings.filter((c) => c.position > center.x)
  const left = crossings.filter((c) => c.position < center.x).reverse()

  const thicknesses: number[] = []
  if (right.length === 2) {
    thicknesses.push(right[1].position - right[0].position)
  }
  if (left.length === 2) {
    thicknesses.push(left[0].position - left[1].position)
  }
  const valid = thicknesses.filter((t) => t > 0)
  return valid.length > 0 ? median(valid) : null
}

export interface StressResult {
  /** Angle of the thinnest axis relative to vertical stress, in degrees. */
  angle: number
  thinnest: number
  thickest: number
  /** Number of angular samples that survived outlier rejection. */
  samples: number
}

/** Maps an angle into (-90, 90]. */
function toHalfTurn(degrees: number): number {
  let value = degrees % 180
  if (value > 90) value -= 180
  if (value <= -90) value += 180
  return value
}

/**
 * Finds the stress axis of a round glyph: the direction in which the stroke
 * is thinnest. 0 degrees means vertical stress (thin top and bottom), which
 * is typical of transitional and modern faces; a tilted value indicates an
 * oldstyle or humanist design.
 *
 * Samples where the ray does not cleanly cross both the counter and the
 * outer edge are discarded by measureRingThickness, so the extremes here
 * are taken over trustworthy readings only.
 */
export function measureStress(
  outline: Outline,
  step = 5,
): StressResult | null {
  const bounds = outlineBounds(outline)
  const center = {
    x: (bounds.xMin + bounds.xMax) / 2,
    y: (bounds.yMin + bounds.yMax) / 2,
  }

  const samples: Array<{ angle: number; thickness: number }> = []
  for (let a = 0; a < 180; a += step) {
    const thickness = measureRingThickness(outline, center, a)
    if (thickness !== null && thickness > 0) samples.push({ angle: a, thickness })
  }
  if (samples.length < 4) return null

  const kept = samples

  let thinnest = Infinity
  let thickest = 0
  let thinAngle = 90
  for (const sample of kept) {
    if (sample.thickness < thinnest) {
      thinnest = sample.thickness
      thinAngle = sample.angle
    }
    if (sample.thickness > thickest) thickest = sample.thickness
  }

  // A scanline at 90 degrees probes the horizontal strokes, so a thinnest
  // reading there is ordinary vertical stress and is reported as 0.
  return {
    angle: toHalfTurn(thinAngle - 90),
    thinnest,
    thickest,
    samples: kept.length,
  }
}

export interface CornerStats {
  totalNodes: number
  cornerNodes: number
  smoothNodes: number
  /** Mean turn angle at corner nodes, in degrees (180 = reversal). */
  meanCornerAngle: number | null
  /** Fraction of corners that turn more than 60 degrees. */
  sharpFraction: number
}

function tangentIn(
  outline: Outline,
  contourIndex: number,
  nodeIndex: number,
): Point | null {
  const contour = outline.contours[contourIndex]
  const node = contour.nodes[nodeIndex]
  const previous =
    contour.nodes[(nodeIndex - 1 + contour.nodes.length) % contour.nodes.length]
  const reference = node.in ?? (previous.out ?? nodePoint(previous))
  const dx = node.x - reference.x
  const dy = node.y - reference.y
  return Math.hypot(dx, dy) < 1e-9 ? null : { x: dx, y: dy }
}

function tangentOut(
  outline: Outline,
  contourIndex: number,
  nodeIndex: number,
): Point | null {
  const contour = outline.contours[contourIndex]
  const node = contour.nodes[nodeIndex]
  const next = contour.nodes[(nodeIndex + 1) % contour.nodes.length]
  const reference = node.out ?? (next.in ?? nodePoint(next))
  const dx = reference.x - node.x
  const dy = reference.y - node.y
  return Math.hypot(dx, dy) < 1e-9 ? null : { x: dx, y: dy }
}

/** Turn angle at a node in degrees: 0 = straight through, 180 = cusp. */
export function nodeTurnAngle(
  outline: Outline,
  contourIndex: number,
  nodeIndex: number,
): number | null {
  const a = tangentIn(outline, contourIndex, nodeIndex)
  const b = tangentOut(outline, contourIndex, nodeIndex)
  if (!a || !b) return null
  const cross = a.x * b.y - a.y * b.x
  const dot = a.x * b.x + a.y * b.y
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI)
}

export function measureCorners(outlines: Outline[]): CornerStats {
  let totalNodes = 0
  let cornerNodes = 0
  let sharp = 0
  const angles: number[] = []

  for (const outline of outlines) {
    outline.contours.forEach((contour, contourIndex) => {
      contour.nodes.forEach((_node, nodeIndex) => {
        totalNodes += 1
        const angle = nodeTurnAngle(outline, contourIndex, nodeIndex)
        if (angle === null) return
        // A node counts as a corner when the path visibly changes direction.
        if (angle > 12) {
          cornerNodes += 1
          angles.push(angle)
          if (angle > 60) sharp += 1
        }
      })
    })
  }

  return {
    totalNodes,
    cornerNodes,
    smoothNodes: totalNodes - cornerNodes,
    meanCornerAngle: mean(angles),
    sharpFraction: cornerNodes === 0 ? 0 : sharp / cornerNodes,
  }
}

export interface CurvatureStats {
  meanRadius: number | null
  /** Coefficient of variation of curvature across sampled curve points. */
  variation: number | null
  samples: number
}

/**
 * Curvature consistency across the curved segments of a glyph. Even,
 * circular curves give a low variation; curves that flatten and tighten
 * along their length give a high one.
 */
export function measureCurvature(outlines: Outline[]): CurvatureStats {
  const curvatures: number[] = []
  for (const outline of outlines) {
    for (const contour of outline.contours) {
      for (const segment of contourSegments(contour)) {
        if (segment.kind !== 'cubic') continue
        for (let i = 1; i < 5; i += 1) {
          const k = Math.abs(
            cubicCurvatureAt(
              segment.from,
              segment.c1,
              segment.c2,
              segment.to,
              i / 5,
            ),
          )
          if (Number.isFinite(k) && k > 1e-9) curvatures.push(k)
        }
      }
    }
  }
  if (curvatures.length === 0) {
    return { meanRadius: null, variation: null, samples: 0 }
  }
  const m = mean(curvatures)!
  const sd = standardDeviation(curvatures)
  return {
    meanRadius: m > 0 ? 1 / m : null,
    variation: sd === null || m === 0 ? null : sd / m,
    samples: curvatures.length,
  }
}

/**
 * Ratio of a stem's foot width to the stem itself. A serifed stem flares out
 * at the baseline, so the ratio rises well above 1; a sans stays near 1.
 *
 * The foot is taken as the widest single run at the baseline rather than the
 * glyph's total span, so multi-stem glyphs such as 'H' and 'n' measure one
 * foot instead of the whole width.
 */
export function measureSerifRatio(outline: Outline): number | null {
  const bounds = outlineBounds(outline)
  const height = bounds.yMax - bounds.yMin
  if (height <= 0) return null

  const stem = measureVerticalStem(outline, {
    from: bounds.yMin + height * 0.4,
    to: bounds.yMin + height * 0.7,
    samples: 9,
  })
  if (stem === null || stem <= 0) return null

  const footWidths: number[] = []
  for (const fraction of [0.005, 0.015, 0.03]) {
    const runs = inkRunsAtY(outline, bounds.yMin + height * fraction)
    if (runs.length === 0) continue
    footWidths.push(Math.max(...runs.map((run) => run.width)))
  }
  const foot = median(footWidths)
  return foot === null ? null : foot / stem
}

/** Slant of a stem, in degrees; positive leans right (italic). */
export function measureSlant(outline: Outline): number | null {
  const bounds = outlineBounds(outline)
  const height = bounds.yMax - bounds.yMin
  if (height <= 0) return null

  const centersAt = (y: number): number | null => {
    const runs = inkRunsAtY(outline, y)
    if (runs.length === 0) return null
    const widest = runs.reduce((a, b) => (b.width > a.width ? b : a))
    return (widest.start + widest.end) / 2
  }

  const lowY = bounds.yMin + height * 0.2
  const highY = bounds.yMin + height * 0.8
  const low = centersAt(lowY)
  const high = centersAt(highY)
  if (low === null || high === null) return null

  return (Math.atan2(high - low, highY - lowY) * 180) / Math.PI
}

export function rectAspect(rect: Rect): number | null {
  const height = rect.yMax - rect.yMin
  if (height <= 0) return null
  return (rect.xMax - rect.xMin) / height
}
