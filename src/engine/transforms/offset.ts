/**
 * Contour offsetting -- the geometry behind "make this heavier / lighter".
 *
 * The offset of a cubic Bezier is not itself a cubic, so it has to be
 * approximated. The approach here is the standard one:
 *
 *   1. Split each curve until every piece turns through a small angle, so
 *      each piece behaves like a circular arc.
 *   2. Move each piece's endpoints along the normal, and scale its handles
 *      by (1 - h*k), the exact factor by which arc length changes when an
 *      arc of curvature k is offset by h. For a true arc this is exact.
 *   3. Rejoin consecutive pieces, mitring where the original had a corner.
 *
 * Direction is taken from each contour's winding, so outer contours grow
 * outward and counters shrink -- which is what makes a glyph look bolder
 * rather than merely bigger.
 */
import type { Contour, Outline, Point, Segment } from '@/types/geometry'
import {
  contourSegments,
  contourSignedArea,
  createNode,
} from '@/engine/geometry/outline'
import {
  cubicCurvatureAt,
  cubicDerivativeAt,
  splitCubic,
} from '@/engine/geometry/bezier'
import { contourIsOuter } from '@/engine/geometry/nesting'
import { createId } from '@/utils/id'

/** Piece of an offset contour: a line when the handles are absent. */
interface Piece {
  from: Point
  c1: Point | null
  c2: Point | null
  to: Point
}

const EPS = 1e-9

function normalize(v: Point): Point {
  const length = Math.hypot(v.x, v.y)
  return length < EPS ? { x: 0, y: 0 } : { x: v.x / length, y: v.y / length }
}

/** Left-hand normal of a direction vector, in a y-up space. */
function leftNormal(direction: Point): Point {
  return { x: -direction.y, y: direction.x }
}

function tangentAt(segment: Segment, t: number): Point {
  if (segment.kind === 'line') {
    return normalize({
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y,
    })
  }
  let derivative = cubicDerivativeAt(
    segment.from,
    segment.c1,
    segment.c2,
    segment.to,
    t,
  )
  if (Math.hypot(derivative.x, derivative.y) < EPS) {
    // Degenerate handle: fall back to the chord.
    derivative = { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y }
  }
  return normalize(derivative)
}

/** Total turning of the tangent across a cubic, in radians. */
function turningAngle(p0: Point, c1: Point, c2: Point, p3: Point): number {
  let total = 0
  let previous = normalize(cubicDerivativeAt(p0, c1, c2, p3, 0))
  for (let i = 1; i <= 8; i += 1) {
    const current = normalize(cubicDerivativeAt(p0, c1, c2, p3, i / 8))
    const cross = previous.x * current.y - previous.y * current.x
    const dot = previous.x * current.x + previous.y * current.y
    total += Math.abs(Math.atan2(cross, dot))
    previous = current
  }
  return total
}

/** Offsets one cubic that is assumed to turn only a little. */
function offsetArcLikeCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
  h: number,
): Piece {
  const t0 = normalize(cubicDerivativeAt(p0, c1, c2, p3, 0))
  const t1 = normalize(cubicDerivativeAt(p0, c1, c2, p3, 1))
  const n0 = leftNormal(t0)
  const n1 = leftNormal(t1)

  const k0 = cubicCurvatureAt(p0, c1, c2, p3, 0)
  const k1 = cubicCurvatureAt(p0, c1, c2, p3, 1)

  // Arc length scales by (1 - h*k) when an arc is offset by h along its
  // left normal. Clamping keeps a cusp from inverting the handles.
  const clamp = (value: number): number => Math.min(6, Math.max(0.02, value))
  const s0 = clamp(1 - h * k0)
  const s1 = clamp(1 - h * k1)

  const from = { x: p0.x + n0.x * h, y: p0.y + n0.y * h }
  const to = { x: p3.x + n1.x * h, y: p3.y + n1.y * h }

  const l1 = Math.hypot(c1.x - p0.x, c1.y - p0.y) * s0
  const l2 = Math.hypot(c2.x - p3.x, c2.y - p3.y) * s1

  return {
    from,
    c1: { x: from.x + t0.x * l1, y: from.y + t0.y * l1 },
    c2: { x: to.x - t1.x * l2, y: to.y - t1.y * l2 },
    to,
  }
}

function offsetSegment(segment: Segment, h: number): Piece[] {
  if (segment.kind === 'line') {
    const direction = normalize({
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y,
    })
    const n = leftNormal(direction)
    return [
      {
        from: { x: segment.from.x + n.x * h, y: segment.from.y + n.y * h },
        c1: null,
        c2: null,
        to: { x: segment.to.x + n.x * h, y: segment.to.y + n.y * h },
      },
    ]
  }

  const { from, c1, c2, to } = segment
  // One piece per ~20 degrees of turning keeps the arc assumption honest.
  const turn = turningAngle(from, c1, c2, to)
  const count = Math.min(12, Math.max(1, Math.ceil(turn / (Math.PI / 9))))

  const pieces: Piece[] = []
  let current: [Point, Point, Point, Point] = [from, c1, c2, to]
  for (let i = 0; i < count; i += 1) {
    const remaining = count - i
    if (remaining === 1) {
      pieces.push(offsetArcLikeCubic(current[0], current[1], current[2], current[3], h))
      break
    }
    const { left, right } = splitCubic(
      current[0],
      current[1],
      current[2],
      current[3],
      1 / remaining,
    )
    pieces.push(offsetArcLikeCubic(left[0], left[1], left[2], left[3], h))
    current = right
  }
  return pieces
}

/** Intersection of two lines given as point + direction, or null. */
function intersect(
  p1: Point,
  d1: Point,
  p2: Point,
  d2: Point,
): Point | null {
  const denominator = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(denominator) < 1e-8) return null
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denominator
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t }
}

export interface OffsetOptions {
  /** Corner handling when the offset opens a gap. */
  join?: 'miter' | 'bevel'
  /** Miter limit as a multiple of the offset distance. */
  miterLimit?: number
}

function piecesToContour(
  pieces: Piece[],
  closed: boolean,
  id: string,
): Contour | null {
  if (pieces.length === 0) return null
  const nodes = pieces.map((piece, index) => {
    const previous = pieces[(index - 1 + pieces.length) % pieces.length]
    return createNode(piece.from.x, piece.from.y, {
      in: previous.c2 ? { ...previous.c2 } : null,
      out: piece.c1 ? { ...piece.c1 } : null,
    })
  })
  if (nodes.length < 2) return null
  return { id, nodes, closed }
}

/**
 * Offsets a single contour by `distance` (positive grows the ink).
 * Returns null when the contour collapses.
 */
export function offsetContour(
  contour: Contour,
  distance: number,
  options: OffsetOptions = {},
  /** False when the contour is a counter, which must shrink as ink grows. */
  isOuter = true,
): Contour | null {
  if (contour.nodes.length < 2 || Math.abs(distance) < EPS) return contour

  const segments = contourSegments(contour)
  if (segments.length === 0) return contour

  // Moving away from a contour's own interior is the right normal when it
  // runs counter-clockwise and the left normal when it runs clockwise. A
  // counter then flips again, because growing the ink shrinks the hole.
  const counterClockwise = contourSignedArea(contour) > 0
  const away = counterClockwise ? -distance : distance
  const h = isOuter ? away : -away

  const offsetGroups = segments.map((segment) => offsetSegment(segment, h))
  const pieces: Piece[] = []

  offsetGroups.forEach((group, groupIndex) => {
    if (groupIndex > 0 || contour.closed) {
      const previousGroup =
        offsetGroups[(groupIndex - 1 + offsetGroups.length) % offsetGroups.length]
      const previousPiece = previousGroup[previousGroup.length - 1]
      const nextPiece = group[0]
      const gap = Math.hypot(
        nextPiece.from.x - previousPiece.to.x,
        nextPiece.from.y - previousPiece.to.y,
      )
      if (gap > Math.abs(distance) * 1e-3 + 1e-6) {
        const previousSegment =
          segments[(groupIndex - 1 + segments.length) % segments.length]
        const outgoing = tangentAt(segments[groupIndex], 0)
        const incoming = tangentAt(previousSegment, 1)
        const miter =
          (options.join ?? 'miter') === 'miter'
            ? intersect(previousPiece.to, incoming, nextPiece.from, outgoing)
            : null
        const limit = Math.abs(distance) * (options.miterLimit ?? 4)
        if (
          miter &&
          Math.hypot(miter.x - previousPiece.to.x, miter.y - previousPiece.to.y) <=
            limit
        ) {
          pieces.push({ from: previousPiece.to, c1: null, c2: null, to: miter })
          pieces.push({ from: miter, c1: null, c2: null, to: nextPiece.from })
        } else {
          pieces.push({
            from: previousPiece.to,
            c1: null,
            c2: null,
            to: nextPiece.from,
          })
        }
      }
    }
    pieces.push(...group)
  })

  return piecesToContour(pieces, contour.closed, createId('c'))
}

/**
 * Offsets every contour of a glyph. Positive distances make the glyph
 * heavier; negative ones make it lighter.
 */
export function offsetOutline(
  outline: Outline,
  distance: number,
  options: OffsetOptions = {},
): Outline {
  if (Math.abs(distance) < EPS) return outline
  const outers = contourIsOuter(outline)
  const contours: Contour[] = []
  outline.contours.forEach((contour, index) => {
    const offsetted = offsetContour(contour, distance, options, outers[index])
    if (offsetted && offsetted.nodes.length >= 2) contours.push(offsetted)
  })
  return { contours }
}

/**
 * Reports whether an offset is likely to damage a glyph: contracting by more
 * than roughly half the narrowest stroke will collapse it.
 */
export function offsetIsRisky(
  distance: number,
  narrowestStroke: number | null,
): boolean {
  if (distance >= 0 || narrowestStroke === null) return false
  return Math.abs(distance) * 2 >= narrowestStroke * 0.9
}

