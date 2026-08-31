/**
 * Cubic to quadratic conversion.
 *
 * TrueType `glyf` outlines are quadratic, so exporting an edited glyph to
 * TTF means approximating each cubic with one or more quadratics. There is
 * no exact conversion, so this subdivides until the approximation is within
 * a tolerance measured in font units.
 *
 * The single-quadratic approximation puts the control point where the two
 * end tangents meet, which is the standard construction and exact whenever
 * the cubic happens to be an elevated quadratic.
 */
import type { Point } from '@/types/geometry'
import { cubicAt, splitCubic } from './bezier'

export interface Quadratic {
  from: Point
  control: Point
  to: Point
}

const EPS = 1e-12

function quadraticAt(q: Quadratic, t: number): Point {
  const mt = 1 - t
  return {
    x: mt * mt * q.from.x + 2 * mt * t * q.control.x + t * t * q.to.x,
    y: mt * mt * q.from.y + 2 * mt * t * q.control.y + t * t * q.to.y,
  }
}

/** Intersection of the tangent at p0 with the tangent at p3. */
function tangentIntersection(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
): Point | null {
  let d1 = { x: c1.x - p0.x, y: c1.y - p0.y }
  let d2 = { x: p3.x - c2.x, y: p3.y - c2.y }

  // Degenerate handles: fall back to the chord direction.
  if (Math.hypot(d1.x, d1.y) < EPS) d1 = { x: c2.x - p0.x, y: c2.y - p0.y }
  if (Math.hypot(d2.x, d2.y) < EPS) d2 = { x: p3.x - c1.x, y: p3.y - c1.y }
  if (Math.hypot(d1.x, d1.y) < EPS || Math.hypot(d2.x, d2.y) < EPS) return null

  const denominator = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(denominator) < 1e-10) return null

  const t = ((p3.x - p0.x) * d2.y - (p3.y - p0.y) * d2.x) / denominator
  return { x: p0.x + d1.x * t, y: p0.y + d1.y * t }
}

function approximate(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
): Quadratic {
  const control = tangentIntersection(p0, c1, c2, p3)
  if (control && Number.isFinite(control.x) && Number.isFinite(control.y)) {
    return { from: p0, control, to: p3 }
  }
  // Parallel tangents: use the classic degree-reduction midpoint.
  return {
    from: p0,
    control: {
      x: (3 * (c1.x + c2.x) - (p0.x + p3.x)) / 4,
      y: (3 * (c1.y + c2.y) - (p0.y + p3.y)) / 4,
    },
    to: p3,
  }
}

/** Largest deviation between the cubic and its quadratic approximation. */
function deviation(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
  q: Quadratic,
): number {
  let worst = 0
  for (let i = 1; i < 8; i += 1) {
    const t = i / 8
    const a = cubicAt(p0, c1, c2, p3, t)
    const b = quadraticAt(q, t)
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y))
  }
  return worst
}

/**
 * Approximates one cubic with a chain of quadratics, each within
 * `tolerance` font units of the original.
 */
export function cubicToQuadratics(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
  tolerance = 0.35,
  depth = 0,
): Quadratic[] {
  const candidate = approximate(p0, c1, c2, p3)
  if (
    depth >= 8 ||
    deviation(p0, c1, c2, p3, candidate) <= tolerance ||
    Math.hypot(p3.x - p0.x, p3.y - p0.y) < tolerance
  ) {
    return [candidate]
  }
  const { left, right } = splitCubic(p0, c1, c2, p3, 0.5)
  return [
    ...cubicToQuadratics(left[0], left[1], left[2], left[3], tolerance, depth + 1),
    ...cubicToQuadratics(right[0], right[1], right[2], right[3], tolerance, depth + 1),
  ]
}
