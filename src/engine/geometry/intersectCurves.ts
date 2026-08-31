/**
 * Curve-curve intersection.
 *
 * Two cubics can meet in up to nine places and there is no closed form, so
 * this uses the standard approach: recursively split both curves and discard
 * any pair whose bounding boxes miss each other. What survives shrinks to a
 * point, and the parameters on both curves fall out of the recursion.
 *
 * Lines are widened to cubics so there is only one code path to get right.
 */
import type { Point, Segment } from '@/types/geometry'
import { cubicAt, cubicBounds, splitCubic } from './bezier'

export type Cubic = readonly [Point, Point, Point, Point]

/** Every segment as a cubic, so intersection has a single implementation. */
export function segmentToCubic(segment: Segment): Cubic {
  if (segment.kind === 'cubic') {
    return [segment.from, segment.c1, segment.c2, segment.to]
  }
  const { from, to } = segment
  return [
    from,
    { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    { x: from.x + (2 * (to.x - from.x)) / 3, y: from.y + (2 * (to.y - from.y)) / 3 },
    to,
  ]
}

export interface CurveIntersection {
  /** Parameter on the first curve. */
  t1: number
  /** Parameter on the second curve. */
  t2: number
  point: Point
}

interface Candidate {
  a: Cubic
  b: Cubic
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
  depth: number
}

function boxesOverlap(a: Cubic, b: Cubic, slack: number): boolean {
  const ba = cubicBounds(a[0], a[1], a[2], a[3])
  const bb = cubicBounds(b[0], b[1], b[2], b[3])
  return (
    ba.xMin - slack <= bb.xMax &&
    bb.xMin - slack <= ba.xMax &&
    ba.yMin - slack <= bb.yMax &&
    bb.yMin - slack <= ba.yMax
  )
}

function boxSize(curve: Cubic): number {
  const bounds = cubicBounds(curve[0], curve[1], curve[2], curve[3])
  return Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin)
}

function split(curve: Cubic): [Cubic, Cubic] {
  const { left, right } = splitCubic(curve[0], curve[1], curve[2], curve[3], 0.5)
  return [left, right]
}

/**
 * Intersections between two cubics, as parameter pairs.
 *
 * `tolerance` is in font units and decides both how close counts as touching
 * and how tightly the recursion converges.
 */
export function intersectCubics(
  a: Cubic,
  b: Cubic,
  tolerance = 0.05,
  maxResults = 16,
): CurveIntersection[] {
  const results: CurveIntersection[] = []
  const stack: Candidate[] = [
    { a, b, aStart: 0, aEnd: 1, bStart: 0, bEnd: 1, depth: 0 },
  ]

  while (stack.length > 0 && results.length < maxResults) {
    const item = stack.pop()!
    if (!boxesOverlap(item.a, item.b, tolerance)) continue

    const sizeA = boxSize(item.a)
    const sizeB = boxSize(item.b)

    if ((sizeA <= tolerance && sizeB <= tolerance) || item.depth >= 34) {
      const t1 = (item.aStart + item.aEnd) / 2
      const t2 = (item.bStart + item.bEnd) / 2
      const point = cubicAt(a[0], a[1], a[2], a[3], t1)
      // The recursion converges from several directions onto one crossing.
      const duplicate = results.some(
        (existing) =>
          Math.hypot(existing.point.x - point.x, existing.point.y - point.y) <
          tolerance * 8,
      )
      if (!duplicate) results.push({ t1, t2, point })
      continue
    }

    if (sizeA >= sizeB) {
      const [left, right] = split(item.a)
      const middle = (item.aStart + item.aEnd) / 2
      stack.push({ ...item, a: left, aEnd: middle, depth: item.depth + 1 })
      stack.push({ ...item, a: right, aStart: middle, depth: item.depth + 1 })
    } else {
      const [left, right] = split(item.b)
      const middle = (item.bStart + item.bEnd) / 2
      stack.push({ ...item, b: left, bEnd: middle, depth: item.depth + 1 })
      stack.push({ ...item, b: right, bStart: middle, depth: item.depth + 1 })
    }
  }

  return results
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Whether a reported hit is just two curves meeting end to end.
 *
 * This has to be decided on position, not on the parameters. The recursion
 * only narrows a parameter to about `tolerance` divided by the curve's
 * length, so a shared corner lands at t = 0.9998 rather than exactly 1, and
 * a parametric test misses it.
 */
export function isJoinHit(
  a: Cubic,
  b: Cubic,
  hit: CurveIntersection,
  tolerance: number,
): boolean {
  const near = Math.max(tolerance * 10, 0.25)
  const onA =
    distance(hit.point, a[0]) <= near || distance(hit.point, a[3]) <= near
  const onB =
    distance(hit.point, b[0]) <= near || distance(hit.point, b[3]) <= near
  return onA && onB
}

/**
 * Self-intersections of one cubic: the curve is split in two and the halves
 * are intersected, which finds the single loop a cubic can form.
 */
export function selfIntersectCubic(
  curve: Cubic,
  tolerance = 0.05,
): CurveIntersection[] {
  const [left, right] = split(curve)
  const middle = cubicAt(curve[0], curve[1], curve[2], curve[3], 0.5)
  const near = Math.max(tolerance * 10, 0.25)

  return intersectCubics(left, right, tolerance, 4)
    .filter((hit) => distance(hit.point, middle) > near)
    .map((hit) => ({
      t1: hit.t1 / 2,
      t2: 0.5 + hit.t2 / 2,
      point: hit.point,
    }))
}

/** Splits a cubic at several parameters, returning the pieces in order. */
export function splitCubicAt(
  curve: Cubic,
  parameters: readonly number[],
): Cubic[] {
  const sorted = [...new Set(parameters)]
    .filter((t) => t > 1e-6 && t < 1 - 1e-6)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return [curve]

  const pieces: Cubic[] = []
  let remaining = curve
  let consumed = 0

  for (const t of sorted) {
    // Re-parameterise into what is left of the curve.
    const local = (t - consumed) / (1 - consumed)
    if (!(local > 1e-9 && local < 1 - 1e-9)) continue
    const { left, right } = splitCubic(
      remaining[0],
      remaining[1],
      remaining[2],
      remaining[3],
      local,
    )
    pieces.push(left)
    remaining = right
    consumed = t
  }
  pieces.push(remaining)
  return pieces
}
