/**
 * Scanline intersection and point-containment.
 *
 * These are the primitives the analyzer uses to measure real ink: stem
 * widths, stroke contrast and overshoot are all derived from where a
 * horizontal or vertical line actually crosses the outline, never from a
 * rasterised bitmap.
 */
import type { Outline, Point, Segment } from '@/types/geometry'
import { contourSegments, outlineSegments } from './outline'
import { cubicAt, cubicExtremaParams, EPSILON } from './bezier'

/** Real roots of at^3 + bt^2 + ct + d, unfiltered. */
export function solveCubic(
  a: number,
  b: number,
  c: number,
  d: number,
): number[] {
  if (Math.abs(a) < 1e-12) return solveQuadratic(b, c, d)

  const bn = b / a
  const cn = c / a
  const dn = d / a

  // Depressed cubic t = x - bn/3  =>  x^3 + px + q
  const p = cn - (bn * bn) / 3
  const q = (2 * bn * bn * bn) / 27 - (bn * cn) / 3 + dn
  const shift = -bn / 3

  const discriminant = (q * q) / 4 + (p * p * p) / 27

  if (discriminant > 1e-14) {
    const sqrtD = Math.sqrt(discriminant)
    return [Math.cbrt(-q / 2 + sqrtD) + Math.cbrt(-q / 2 - sqrtD) + shift]
  }
  if (Math.abs(discriminant) <= 1e-14) {
    const u = Math.cbrt(-q / 2)
    return [2 * u + shift, -u + shift]
  }
  // Three distinct real roots.
  const r = Math.sqrt(-(p * p * p) / 27)
  const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))))
  const m = 2 * Math.cbrt(r)
  return [
    m * Math.cos(phi / 3) + shift,
    m * Math.cos((phi + 2 * Math.PI) / 3) + shift,
    m * Math.cos((phi + 4 * Math.PI) / 3) + shift,
  ]
}

export function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return []
    return [-c / b]
  }
  const disc = b * b - 4 * a * c
  if (disc < 0) return []
  if (disc === 0) return [-b / (2 * a)]
  const sq = Math.sqrt(disc)
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]
}

export interface Crossing {
  /** Coordinate along the scanline where the outline is crossed. */
  position: number
  /** +1 when the outline crosses in the increasing direction, -1 otherwise. */
  winding: number
}

type Axis = 'x' | 'y'

/**
 * Crossings of one segment with a scanline.
 *
 * The rule is y-ordered rather than parametric: a crossing counts when the
 * scanline value lies in [min, max) of a monotonic run. That is what makes
 * vertices behave. With a parametric [0, 1) rule the segment that *starts*
 * at a shared vertex always counts it, so a path that touches the scanline
 * at a local maximum and turns back gets counted once instead of not at
 * all -- and every winding number computed through that row comes out wrong.
 *
 * Curves are split at their extrema first so each piece really is monotonic.
 */
function crossingsOfSegment(
  segment: Segment,
  axis: Axis,
  value: number,
  out: Crossing[],
): void {
  const pick = (p: Point): number => (axis === 'y' ? p.y : p.x)
  const other = (p: Point): number => (axis === 'y' ? p.x : p.y)

  if (segment.kind === 'line') {
    const a = pick(segment.from)
    const b = pick(segment.to)
    // A segment running along the scanline never crosses it.
    if (Math.abs(b - a) < EPSILON) return
    if (value < Math.min(a, b) || value >= Math.max(a, b)) return
    const t = (value - a) / (b - a)
    out.push({
      position:
        other(segment.from) + (other(segment.to) - other(segment.from)) * t,
      winding: b > a ? 1 : -1,
    })
    return
  }

  const p0 = pick(segment.from)
  const p1 = pick(segment.c1)
  const p2 = pick(segment.c2)
  const p3 = pick(segment.to)

  const at = (t: number): number => {
    const mt = 1 - t
    return (
      mt * mt * mt * p0 +
      3 * mt * mt * t * p1 +
      3 * mt * t * t * p2 +
      t * t * t * p3
    )
  }

  // Break the curve at its extrema along this axis so every run is monotonic.
  const breaks = [0, ...cubicExtremaParams(p0, p1, p2, p3), 1].sort(
    (a, b) => a - b,
  )

  for (let i = 0; i < breaks.length - 1; i += 1) {
    const ta = breaks[i]
    const tb = breaks[i + 1]
    const ya = at(ta)
    const yb = at(tb)
    if (Math.abs(yb - ya) < EPSILON) continue
    if (value < Math.min(ya, yb) || value >= Math.max(ya, yb)) continue

    // Monotonic, so a bisection converges reliably. Thirty-six halvings
    // take the interval well below font-unit precision.
    let lo = ta
    let hi = tb
    const increasing = yb > ya
    for (let step = 0; step < 36 && hi - lo > 1e-12; step += 1) {
      const mid = (lo + hi) / 2
      const y = at(mid)
      if (increasing ? y < value : y > value) lo = mid
      else hi = mid
    }
    const t = (lo + hi) / 2
    const point = cubicAt(segment.from, segment.c1, segment.c2, segment.to, t)
    out.push({ position: other(point), winding: increasing ? 1 : -1 })
  }
}

/** Crossings of the horizontal line y = `y`, sorted left to right. */
export function horizontalCrossings(outline: Outline, y: number): Crossing[] {
  const out: Crossing[] = []
  for (const segment of outlineSegments(outline)) {
    crossingsOfSegment(segment, 'y', y, out)
  }
  return out.sort((a, b) => a.position - b.position)
}

/** Crossings of the vertical line x = `x`, sorted bottom to top. */
export function verticalCrossings(outline: Outline, x: number): Crossing[] {
  const out: Crossing[] = []
  for (const segment of outlineSegments(outline)) {
    crossingsOfSegment(segment, 'x', x, out)
  }
  return out.sort((a, b) => a.position - b.position)
}

export interface InkRun {
  start: number
  end: number
  width: number
}

/**
 * Converts crossings into the filled spans along the scanline using the
 * non-zero winding rule, which is what both TrueType and CFF fills use.
 */
export function runsFromCrossings(crossings: Crossing[]): InkRun[] {
  const runs: InkRun[] = []
  let winding = 0
  let start = 0
  for (const crossing of crossings) {
    const before = winding
    winding += crossing.winding
    if (before === 0 && winding !== 0) {
      start = crossing.position
    } else if (before !== 0 && winding === 0) {
      const width = crossing.position - start
      if (width > EPSILON) runs.push({ start, end: crossing.position, width })
    }
  }
  return runs
}

/** Filled horizontal spans at height `y`. */
export function inkRunsAtY(outline: Outline, y: number): InkRun[] {
  return runsFromCrossings(horizontalCrossings(outline, y))
}

/** Filled vertical spans at abscissa `x`. */
export function inkRunsAtX(outline: Outline, x: number): InkRun[] {
  return runsFromCrossings(verticalCrossings(outline, x))
}

export function isPointInside(outline: Outline, point: Point): boolean {
  let winding = 0
  for (const crossing of horizontalCrossings(outline, point.y)) {
    if (crossing.position <= point.x) winding += crossing.winding
  }
  return winding !== 0
}

/**
 * Total ink area, signed by winding. Sums contour areas so counters
 * (which run opposite to their outer contour) subtract correctly.
 */
export function inkArea(outline: Outline): number {
  let total = 0
  for (const contour of outline.contours) {
    let area = 0
    const nodes = contour.nodes
    const count = contour.closed ? nodes.length : nodes.length - 1
    for (let i = 0; i < count; i += 1) {
      const a = nodes[i]
      const b = nodes[(i + 1) % nodes.length]
      area += (a.x * b.y - b.x * a.y) / 2
    }
    for (const segment of contourSegments(contour)) {
      if (segment.kind === 'cubic') {
        const { from, c1, c2, to } = segment
        area +=
          (-3 / 20) *
          (from.x * (-2 * c1.y - c2.y + 3 * to.y) +
            c1.x * (2 * from.y - c2.y - to.y) +
            c2.x * (from.y + c1.y - 2 * to.y) +
            to.x * (-3 * from.y + c1.y + 2 * c2.y))
      }
    }
    total += area
  }
  return Math.abs(total)
}
