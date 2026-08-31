/**
 * Traced polygons to an editable outline.
 *
 * Marching squares produces a dense ring of points. Turning that into
 * something a designer can work with means three things: throwing away the
 * points that carry no information, deciding which of the survivors are real
 * corners, and fitting curves through the runs between them. Skip the corner
 * step and every sharp junction comes out rounded off.
 */
import type { Contour, Outline, Point } from '@/types/geometry'
import { createNode } from '@/engine/geometry/outline'
import { fitCubicRun } from '@/engine/geometry/simplify'
import { createId } from '@/utils/id'
import type { TracedPolygon } from './trace'

export interface VectorizeOptions {
  /** Curve fitting tolerance, in image pixels. */
  tolerance?: number
  /** Points closer than this to the chord between neighbours are dropped. */
  simplifyTolerance?: number
  /** Turn sharper than this many degrees is treated as a corner. */
  cornerAngle?: number
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function normalize(p: Point): Point {
  const length = Math.hypot(p.x, p.y)
  return length < 1e-12 ? { x: 0, y: 0 } : { x: p.x / length, y: p.y / length }
}

/** Perpendicular distance from a point to the line through a and b. */
function perpendicularDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y)
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length
}

/** Ramer-Douglas-Peucker, iterative so a long ring cannot blow the stack. */
export function simplifyPolyline(
  points: readonly Point[],
  tolerance: number,
): Point[] {
  if (points.length < 3) return [...points]

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    let worst = 0
    let index = -1
    for (let i = start + 1; i < end; i += 1) {
      const d = perpendicularDistance(points[i], points[start], points[end])
      if (d > worst) {
        worst = d
        index = i
      }
    }
    if (index >= 0 && worst > tolerance) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }

  return points.filter((_, index) => keep[index] === 1)
}

/** Indices where the ring turns sharply enough to call a corner. */
function findCorners(points: readonly Point[], cornerAngle: number): number[] {
  const corners: number[] = []
  const limit = Math.cos((cornerAngle * Math.PI) / 180)

  for (let i = 0; i < points.length; i += 1) {
    const previous = points[(i - 1 + points.length) % points.length]
    const next = points[(i + 1) % points.length]
    const incoming = normalize(subtract(points[i], previous))
    const outgoing = normalize(subtract(next, points[i]))
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y
    if (dot < limit) corners.push(i)
  }
  return corners
}

/** Fits one closed ring, honouring its corners. */
function fitRing(points: readonly Point[], options: Required<VectorizeOptions>): Contour | null {
  const simplified = simplifyPolyline(points, options.simplifyTolerance)
  const deduped = simplified.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point.x - simplified[index - 1].x,
        point.y - simplified[index - 1].y,
      ) > 1e-6,
  )
  if (deduped.length < 3) return null

  const corners = findCorners(deduped, options.cornerAngle)
  const curves: Array<[Point, Point, Point, Point]> = []

  // With no corners the whole ring is one smooth run; otherwise each stretch
  // between consecutive corners is fitted on its own so corners stay sharp.
  const runs: Point[][] = []
  if (corners.length === 0) {
    runs.push([...deduped, deduped[0]])
  } else {
    for (let i = 0; i < corners.length; i += 1) {
      const start = corners[i]
      const end = corners[(i + 1) % corners.length]
      const run: Point[] = []
      let cursor = start
      do {
        run.push(deduped[cursor])
        cursor = (cursor + 1) % deduped.length
      } while (cursor !== end)
      run.push(deduped[end])
      if (run.length >= 2) runs.push(run)
    }
  }

  for (const run of runs) {
    const tangent1 = normalize(subtract(run[1], run[0]))
    const tangent2 = normalize(
      subtract(run[run.length - 2], run[run.length - 1]),
    )
    curves.push(...fitCubicRun(run, tangent1, tangent2, options.tolerance))
  }

  if (curves.length === 0) return null

  const nodes = curves.map((curve, index) => {
    const previous = curves[(index - 1 + curves.length) % curves.length]
    return createNode(curve[0].x, curve[0].y, {
      in: { ...previous[2] },
      out: { ...curve[1] },
      smooth: false,
    })
  })

  return { id: createId('c'), nodes, closed: true }
}

export interface VectorizeResult {
  /** Outline in image coordinates, y still running downwards. */
  outline: Outline
  contourCount: number
  nodeCount: number
}

export function vectorizePolygons(
  polygons: readonly TracedPolygon[],
  options: VectorizeOptions = {},
): VectorizeResult {
  const resolved: Required<VectorizeOptions> = {
    tolerance: options.tolerance ?? 0.8,
    simplifyTolerance: options.simplifyTolerance ?? 0.35,
    cornerAngle: options.cornerAngle ?? 42,
  }

  const contours: Contour[] = []
  for (const polygon of polygons) {
    const contour = fitRing(polygon.points, resolved)
    if (contour) contours.push(contour)
  }

  return {
    outline: { contours },
    contourCount: contours.length,
    nodeCount: contours.reduce((sum, contour) => sum + contour.nodes.length, 0),
  }
}
