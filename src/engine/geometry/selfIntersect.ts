/**
 * Self-intersection detection.
 *
 * Overlapping contours are one of the most common real defects in font
 * outlines: they render unpredictably under the non-zero fill rule and
 * break many rasterisers outright.
 *
 * Curves are flattened to polylines and tested pairwise, with the pairs
 * pruned by a sweep over sorted x extents so a glyph with hundreds of
 * segments stays cheap. Segments that merely share an endpoint are not
 * intersections.
 */
import type { Outline, Point } from '@/types/geometry'
import { contourSegments } from './outline'
import { flattenCubic } from './bezier'

interface Edge {
  a: Point
  b: Point
  contourIndex: number
  /** Position along the contour, used to skip neighbouring edges. */
  order: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface Intersection {
  point: Point
  contourA: number
  contourB: number
}

const EPS = 1e-9

function buildEdges(outline: Outline, tolerance: number): Edge[] {
  const edges: Edge[] = []
  outline.contours.forEach((contour, contourIndex) => {
    let order = 0
    for (const segment of contourSegments(contour)) {
      const points: Point[] =
        segment.kind === 'line'
          ? [segment.to]
          : flattenCubic(segment.from, segment.c1, segment.c2, segment.to, tolerance)
      let previous = segment.from
      for (const point of points) {
        if (Math.hypot(point.x - previous.x, point.y - previous.y) > EPS) {
          edges.push({
            a: previous,
            b: point,
            contourIndex,
            order: order++,
            xMin: Math.min(previous.x, point.x),
            xMax: Math.max(previous.x, point.x),
            yMin: Math.min(previous.y, point.y),
            yMax: Math.max(previous.y, point.y),
          })
        }
        previous = point
      }
    }
  })
  return edges
}

/** Proper crossing of two open segments, excluding shared endpoints. */
function segmentIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const denominator = d1x * d2y - d1y * d2x
  if (Math.abs(denominator) < 1e-12) return null

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator

  // Strictly interior on both segments: touching at a vertex is legitimate.
  const margin = 1e-7
  if (t <= margin || t >= 1 - margin) return null
  if (u <= margin || u >= 1 - margin) return null

  return { x: p1.x + d1x * t, y: p1.y + d1y * t }
}

export function findSelfIntersections(
  outline: Outline,
  options: { tolerance?: number; limit?: number } = {},
): Intersection[] {
  const tolerance = options.tolerance ?? 1
  const limit = options.limit ?? 24
  const edges = buildEdges(outline, tolerance)
  if (edges.length < 4) return []

  const order = [...edges].sort((a, b) => a.xMin - b.xMin)
  const results: Intersection[] = []
  const active: Edge[] = []

  for (const edge of order) {
    // Drop edges that can no longer overlap anything further right.
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].xMax < edge.xMin) active.splice(i, 1)
    }

    for (const other of active) {
      if (other.yMax < edge.yMin || edge.yMax < other.yMin) continue
      // Neighbouring edges of the same contour meet by construction.
      if (
        other.contourIndex === edge.contourIndex &&
        Math.abs(other.order - edge.order) <= 1
      ) {
        continue
      }
      const point = segmentIntersection(edge.a, edge.b, other.a, other.b)
      if (point) {
        results.push({
          point,
          contourA: edge.contourIndex,
          contourB: other.contourIndex,
        })
        if (results.length >= limit) return dedupe(results, tolerance)
      }
    }
    active.push(edge)
  }

  return dedupe(results, tolerance)
}

/** Flattening turns one true crossing into several nearby hits. */
function dedupe(
  intersections: Intersection[],
  tolerance: number,
): Intersection[] {
  const merged: Intersection[] = []
  const radius = Math.max(tolerance * 4, 2)
  for (const candidate of intersections) {
    const near = merged.some(
      (existing) =>
        Math.hypot(
          existing.point.x - candidate.point.x,
          existing.point.y - candidate.point.y,
        ) < radius,
    )
    if (!near) merged.push(candidate)
  }
  return merged
}

export function hasSelfIntersection(outline: Outline): boolean {
  return findSelfIntersections(outline, { limit: 1 }).length > 0
}
