/**
 * Path simplification.
 *
 * Fits as few cubic segments as possible through the existing curve while
 * staying within a tolerance, using Schneider's algorithm: fit one cubic to
 * a run of points by least squares against a chord-length parameterisation,
 * refine the parameters with Newton-Raphson, and split at the worst error
 * when the fit is not good enough.
 *
 * This matters for real work: contour offsetting subdivides curves to stay
 * accurate, so a thickened glyph can carry four times the nodes it needs.
 * Simplifying afterwards gives back an outline a person can actually edit.
 */
import type { Contour, Outline, Point } from '@/types/geometry'
import { contourSegments, createNode, nodePoint } from './outline'
import { cubicAt, flattenCubic } from './bezier'
import { createId } from '@/utils/id'

const EPS = 1e-12

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function scale(p: Point, k: number): Point {
  return { x: p.x * k, y: p.y * k }
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function length(p: Point): number {
  return Math.hypot(p.x, p.y)
}

function normalize(p: Point): Point {
  const l = length(p)
  return l < EPS ? { x: 0, y: 0 } : { x: p.x / l, y: p.y / l }
}

/** Chord-length parameterisation: a good starting guess for the fit. */
function chordLengthParameters(points: readonly Point[]): number[] {
  const u: number[] = [0]
  for (let i = 1; i < points.length; i += 1) {
    u.push(u[i - 1] + length(subtract(points[i], points[i - 1])))
  }
  const total = u[u.length - 1]
  if (total < EPS) return points.map((_, i) => i / Math.max(1, points.length - 1))
  return u.map((value) => value / total)
}

const B0 = (t: number): number => (1 - t) ** 3
const B1 = (t: number): number => 3 * t * (1 - t) ** 2
const B2 = (t: number): number => 3 * t * t * (1 - t)
const B3 = (t: number): number => t ** 3

/**
 * Least-squares fit of one cubic through `points` with the given end
 * tangents. Returns the four control points.
 */
function fitCubic(
  points: readonly Point[],
  parameters: readonly number[],
  tangent1: Point,
  tangent2: Point,
): [Point, Point, Point, Point] {
  const first = points[0]
  const last = points[points.length - 1]

  // Solve for the two handle lengths (alpha1, alpha2).
  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0

  for (let i = 0; i < points.length; i += 1) {
    const t = parameters[i]
    const a1 = scale(tangent1, B1(t))
    const a2 = scale(tangent2, B2(t))

    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)

    const target = subtract(
      points[i],
      add(
        add(scale(first, B0(t)), scale(first, B1(t))),
        add(scale(last, B2(t)), scale(last, B3(t))),
      ),
    )
    x0 += dot(a1, target)
    x1 += dot(a2, target)
  }

  const determinant = c00 * c11 - c01 * c01
  let alpha1: number
  let alpha2: number

  if (Math.abs(determinant) < EPS) {
    // Degenerate system: fall back to the classic one-third heuristic.
    const chord = length(subtract(last, first)) / 3
    alpha1 = chord
    alpha2 = chord
  } else {
    alpha1 = (x0 * c11 - x1 * c01) / determinant
    alpha2 = (c00 * x1 - c01 * x0) / determinant
  }

  const chord = length(subtract(last, first))
  if (alpha1 < EPS || alpha2 < EPS || alpha1 > chord * 3 || alpha2 > chord * 3) {
    alpha1 = chord / 3
    alpha2 = chord / 3
  }

  return [
    first,
    add(first, scale(tangent1, alpha1)),
    add(last, scale(tangent2, alpha2)),
    last,
  ]
}

/** Worst distance from the sample points to the fitted curve. */
function maxError(
  points: readonly Point[],
  parameters: readonly number[],
  curve: readonly [Point, Point, Point, Point],
): { error: number; index: number } {
  let error = 0
  let index = Math.floor(points.length / 2)
  for (let i = 1; i < points.length - 1; i += 1) {
    const on = cubicAt(curve[0], curve[1], curve[2], curve[3], parameters[i])
    const d = length(subtract(on, points[i]))
    if (d > error) {
      error = d
      index = i
    }
  }
  return { error, index }
}

/** One Newton-Raphson step towards the closest point on the curve. */
function refineParameter(
  point: Point,
  curve: readonly [Point, Point, Point, Point],
  t: number,
): number {
  const [p0, p1, p2, p3] = curve
  const q = cubicAt(p0, p1, p2, p3, t)

  const d1: Point[] = [
    scale(subtract(p1, p0), 3),
    scale(subtract(p2, p1), 3),
    scale(subtract(p3, p2), 3),
  ]
  const d2: Point[] = [
    scale(subtract(d1[1], d1[0]), 2),
    scale(subtract(d1[2], d1[1]), 2),
  ]

  const qd = add(
    add(scale(d1[0], (1 - t) ** 2), scale(d1[1], 2 * t * (1 - t))),
    scale(d1[2], t * t),
  )
  const qdd = add(scale(d2[0], 1 - t), scale(d2[1], t))

  const difference = subtract(q, point)
  const numerator = dot(difference, qd)
  const denominator = dot(qd, qd) + dot(difference, qdd)
  if (Math.abs(denominator) < EPS) return t
  const next = t - numerator / denominator
  return Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : t
}

/**
 * Fits a chain of cubics through an ordered run of points, subdividing at
 * the worst error until every piece is within tolerance.
 *
 * Exported because the image tracer needs exactly this: it produces dense
 * polygons that have to become editable curves.
 */
export function fitCubicRun(
  points: readonly Point[],
  tangent1: Point,
  tangent2: Point,
  tolerance: number,
  depth = 0,
): Array<[Point, Point, Point, Point]> {
  if (points.length === 2) {
    const chord = length(subtract(points[1], points[0])) / 3
    return [
      [
        points[0],
        add(points[0], scale(tangent1, chord)),
        add(points[1], scale(tangent2, chord)),
        points[1],
      ],
    ]
  }

  let parameters = chordLengthParameters(points)
  let curve = fitCubic(points, parameters, tangent1, tangent2)
  let { error, index } = maxError(points, parameters, curve)

  if (error < tolerance) return [curve]

  // A few refinement passes usually rescue a fit that is nearly good.
  if (error < tolerance * tolerance && depth < 20) {
    for (let pass = 0; pass < 4; pass += 1) {
      parameters = points.map((point, i) => refineParameter(point, curve, parameters[i]))
      curve = fitCubic(points, parameters, tangent1, tangent2)
      const next = maxError(points, parameters, curve)
      error = next.error
      index = next.index
      if (error < tolerance) return [curve]
    }
  }

  if (depth >= 24 || index <= 0 || index >= points.length - 1) return [curve]

  // Split at the worst point and fit each half.
  const centre = normalize(
    subtract(points[index - 1], points[index + 1]),
  )
  return [
    ...fitCubicRun(points.slice(0, index + 1), tangent1, centre, tolerance, depth + 1),
    ...fitCubicRun(
      points.slice(index),
      scale(centre, -1),
      tangent2,
      tolerance,
      depth + 1,
    ),
  ]
}

export interface SimplifyOptions {
  /** Maximum deviation in font units. */
  tolerance?: number
  /**
   * Anchors whose tangent turns by more than this are treated as corners and
   * are always kept, so simplifying never rounds off a deliberate corner.
   */
  cornerAngle?: number
}

/** Samples a contour densely, marking which samples are original corners. */
function sampleContour(
  contour: Contour,
  cornerAngle: number,
): Array<{ point: Point; corner: boolean }> {
  const samples: Array<{ point: Point; corner: boolean }> = []
  const segments = contourSegments(contour)
  if (segments.length === 0) return samples

  const isCorner = (index: number): boolean => {
    const node = contour.nodes[index]
    if (!node) return true
    if (!node.smooth) {
      // A node with no handles either side of a straight join is a corner.
      const previous =
        contour.nodes[(index - 1 + contour.nodes.length) % contour.nodes.length]
      const next = contour.nodes[(index + 1) % contour.nodes.length]
      const before = node.in ?? nodePoint(previous)
      const after = node.out ?? nodePoint(next)
      const a = normalize(subtract(nodePoint(node), before))
      const b = normalize(subtract(after, nodePoint(node)))
      if (length(a) < EPS || length(b) < EPS) return true
      const angle =
        (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI
      return angle > cornerAngle
    }
    return false
  }

  segments.forEach((segment, index) => {
    samples.push({ point: segment.from, corner: isCorner(index) })
    if (segment.kind === 'cubic') {
      const flattened = flattenCubic(
        segment.from,
        segment.c1,
        segment.c2,
        segment.to,
        0.05,
      )
      for (let i = 0; i < flattened.length - 1; i += 1) {
        samples.push({ point: flattened[i], corner: false })
      }
    }
  })

  return samples
}

export function simplifyContour(
  contour: Contour,
  options: SimplifyOptions = {},
): Contour {
  const tolerance = options.tolerance ?? 1
  const cornerAngle = options.cornerAngle ?? 30
  if (contour.nodes.length < 3) return contour

  const samples = sampleContour(contour, cornerAngle)
  if (samples.length < 4) return contour

  // Split the ring at its corners; each run between corners is fitted alone
  // so corners survive exactly.
  const cornerIndices = samples
    .map((sample, index) => (sample.corner ? index : -1))
    .filter((index) => index >= 0)

  const runs: Point[][] = []
  if (cornerIndices.length === 0) {
    runs.push([...samples.map((s) => s.point), samples[0].point])
  } else {
    for (let i = 0; i < cornerIndices.length; i += 1) {
      const start = cornerIndices[i]
      const end = cornerIndices[(i + 1) % cornerIndices.length]
      const run: Point[] = []
      let cursor = start
      do {
        run.push(samples[cursor].point)
        cursor = (cursor + 1) % samples.length
      } while (cursor !== end)
      run.push(samples[end].point)
      if (run.length >= 2) runs.push(run)
    }
  }

  const curves: Array<[Point, Point, Point, Point]> = []
  for (const run of runs) {
    const deduped = run.filter(
      (point, index) =>
        index === 0 || length(subtract(point, run[index - 1])) > 1e-6,
    )
    if (deduped.length < 2) continue
    const tangent1 = normalize(subtract(deduped[1], deduped[0]))
    const tangent2 = normalize(
      subtract(deduped[deduped.length - 2], deduped[deduped.length - 1]),
    )
    curves.push(...fitCubicRun(deduped, tangent1, tangent2, tolerance))
  }

  if (curves.length === 0) return contour

  const nodes = curves.map((curve, index) => {
    const previous = curves[(index - 1 + curves.length) % curves.length]
    return createNode(curve[0].x, curve[0].y, {
      in: { ...previous[2] },
      out: { ...curve[1] },
      smooth: true,
    })
  })

  // Only accept the result if it is genuinely simpler.
  if (nodes.length >= contour.nodes.length) return contour
  return { id: createId('c'), nodes, closed: contour.closed }
}

export function simplifyOutline(
  outline: Outline,
  options: SimplifyOptions = {},
): Outline {
  return {
    contours: outline.contours.map((contour) =>
      simplifyContour(contour, options),
    ),
  }
}
