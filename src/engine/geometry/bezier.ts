/**
 * Cubic Bezier primitives.
 *
 * Every curve in the editable outline model is a cubic. Quadratics coming
 * from TrueType `glyf` data are converted exactly on the way in; the
 * approximate direction (cubic -> quadratic) only happens in the TTF
 * exporter.
 */
import type { Point, Rect } from '@/types/geometry'

export const EPSILON = 1e-9

export function pt(x: number, y: number): Point {
  return { x, y }
}

export function pointsEqual(a: Point, b: Point, tolerance = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Exact conversion of a quadratic segment to an equivalent cubic. */
export function quadraticToCubic(
  p0: Point,
  q: Point,
  p1: Point,
): { c1: Point; c2: Point } {
  return {
    c1: { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    c2: { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) },
  }
}

export function cubicAt(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): Point {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  }
}

export function cubicDerivativeAt(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): Point {
  const mt = 1 - t
  return {
    x: 3 * mt * mt * (c1.x - p0.x) + 6 * mt * t * (c2.x - c1.x) + 3 * t * t * (p1.x - c2.x),
    y: 3 * mt * mt * (c1.y - p0.y) + 6 * mt * t * (c2.y - c1.y) + 3 * t * t * (p1.y - c2.y),
  }
}

export function cubicSecondDerivativeAt(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): Point {
  const mt = 1 - t
  return {
    x: 6 * mt * (c2.x - 2 * c1.x + p0.x) + 6 * t * (p1.x - 2 * c2.x + c1.x),
    y: 6 * mt * (c2.y - 2 * c1.y + p0.y) + 6 * t * (p1.y - 2 * c2.y + c1.y),
  }
}

/** Signed curvature at t. Positive turns counter-clockwise in a y-up space. */
export function cubicCurvatureAt(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): number {
  const d = cubicDerivativeAt(p0, c1, c2, p1, t)
  const dd = cubicSecondDerivativeAt(p0, c1, c2, p1, t)
  const speed = Math.hypot(d.x, d.y)
  if (speed < EPSILON) return 0
  return (d.x * dd.y - d.y * dd.x) / (speed * speed * speed)
}

/** de Casteljau split; returns the two halves' control points. */
export function splitCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): {
  left: [Point, Point, Point, Point]
  right: [Point, Point, Point, Point]
} {
  const a = lerpPoint(p0, c1, t)
  const b = lerpPoint(c1, c2, t)
  const c = lerpPoint(c2, p1, t)
  const d = lerpPoint(a, b, t)
  const e = lerpPoint(b, c, t)
  const f = lerpPoint(d, e, t)
  return { left: [p0, a, d, f], right: [f, e, c, p1] }
}

function quadraticRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) < EPSILON) return []
    return [-c / b]
  }
  const disc = b * b - 4 * a * c
  if (disc < 0) return []
  const sq = Math.sqrt(disc)
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]
}

/** Parameters in (0,1) where the derivative of one axis vanishes. */
export function cubicExtremaParams(
  v0: number,
  v1: number,
  v2: number,
  v3: number,
): number[] {
  const a = 3 * (-v0 + 3 * v1 - 3 * v2 + v3)
  const b = 6 * (v0 - 2 * v1 + v2)
  const c = 3 * (v1 - v0)
  return quadraticRoots(a, b, c).filter((t) => t > EPSILON && t < 1 - EPSILON)
}

export function cubicBounds(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
): Rect {
  let xMin = Math.min(p0.x, p1.x)
  let xMax = Math.max(p0.x, p1.x)
  let yMin = Math.min(p0.y, p1.y)
  let yMax = Math.max(p0.y, p1.y)

  for (const t of cubicExtremaParams(p0.x, c1.x, c2.x, p1.x)) {
    const { x } = cubicAt(p0, c1, c2, p1, t)
    xMin = Math.min(xMin, x)
    xMax = Math.max(xMax, x)
  }
  for (const t of cubicExtremaParams(p0.y, c1.y, c2.y, p1.y)) {
    const { y } = cubicAt(p0, c1, c2, p1, t)
    yMin = Math.min(yMin, y)
    yMax = Math.max(yMax, y)
  }
  return { xMin, yMin, xMax, yMax }
}

/**
 * Area enclosed between the curve and its chord, signed the same way as the
 * shoelace formula (counter-clockwise positive in a y-up space).
 *
 * Total contour area = shoelace over the anchor polygon + the sum of these.
 */
export function cubicChordArea(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
): number {
  return (
    (-3 / 20) *
    (p0.x * (-2 * c1.y - c2.y + 3 * p1.y) +
      c1.x * (2 * p0.y - c2.y - p1.y) +
      c2.x * (p0.y + c1.y - 2 * p1.y) +
      p1.x * (-3 * p0.y + c1.y + 2 * c2.y))
  )
}

function flatEnough(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  tolerance: number,
): boolean {
  const ux = 3 * c1.x - 2 * p0.x - p1.x
  const uy = 3 * c1.y - 2 * p0.y - p1.y
  const vx = 3 * c2.x - p0.x - 2 * p1.x
  const vy = 3 * c2.y - p0.y - 2 * p1.y
  const max = Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy)
  return max <= 16 * tolerance * tolerance
}

/** Adaptive flattening. Returns points excluding `p0`, including `p1`. */
export function flattenCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  tolerance = 0.25,
  depth = 0,
): Point[] {
  if (depth >= 16 || flatEnough(p0, c1, c2, p1, tolerance)) {
    return [p1]
  }
  const { left, right } = splitCubic(p0, c1, c2, p1, 0.5)
  return [
    ...flattenCubic(left[0], left[1], left[2], left[3], tolerance, depth + 1),
    ...flattenCubic(right[0], right[1], right[2], right[3], tolerance, depth + 1),
  ]
}

export function cubicLength(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  tolerance = 0.05,
): number {
  let length = 0
  let previous = p0
  for (const point of flattenCubic(p0, c1, c2, p1, tolerance)) {
    length += distance(previous, point)
    previous = point
  }
  return length
}

export interface ClosestResult {
  t: number
  point: Point
  distance: number
}

/** Coarse scan plus golden-section refinement -- good enough for hit-testing. */
export function closestPointOnCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  target: Point,
  samples = 24,
): ClosestResult {
  let bestT = 0
  let bestD = Infinity
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    const d = distance(cubicAt(p0, c1, c2, p1, t), target)
    if (d < bestD) {
      bestD = d
      bestT = t
    }
  }
  let lo = Math.max(0, bestT - 1 / samples)
  let hi = Math.min(1, bestT + 1 / samples)
  for (let i = 0; i < 32; i += 1) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (
      distance(cubicAt(p0, c1, c2, p1, m1), target) <
      distance(cubicAt(p0, c1, c2, p1, m2), target)
    ) {
      hi = m2
    } else {
      lo = m1
    }
  }
  const t = (lo + hi) / 2
  const point = cubicAt(p0, c1, c2, p1, t)
  return { t, point, distance: distance(point, target) }
}

export function closestPointOnLine(
  a: Point,
  b: Point,
  target: Point,
): ClosestResult {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq < EPSILON) {
    return { t: 0, point: a, distance: distance(a, target) }
  }
  let t = ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const point = { x: a.x + dx * t, y: a.y + dy * t }
  return { t, point, distance: distance(point, target) }
}
