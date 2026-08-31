/**
 * Remove Overlap: the union of everything a glyph draws.
 *
 * Overlapping contours are legal and render correctly, but they are not a
 * clean outline: they break stroke effects, confuse interpolation, and many
 * production pipelines require them gone. This is the Pathfinder "unite"
 * operation, done on the real curves rather than on a flattened polygon.
 *
 * The method is the classical one:
 *   1. cut every segment at each place it meets another (or itself)
 *   2. keep only the pieces that separate ink from paper, by testing the
 *      winding just either side of the piece
 *   3. walk the survivors end to end to rebuild closed contours
 *
 * Curve shape is preserved exactly: cutting uses de Casteljau, so a piece of
 * the original curve is still that curve.
 */
import type { Contour, Outline, Point } from '@/types/geometry'
import { contourSegments, createNode } from './outline'
import { cubicAt, cubicDerivativeAt } from './bezier'
import { horizontalCrossings } from './intersect'
import {
  intersectCubics,
  isJoinHit,
  segmentToCubic,
  selfIntersectCubic,
  splitCubicAt,
  type Cubic,
} from './intersectCurves'
import { createId } from '@/utils/id'

interface Piece {
  curve: Cubic
  /** Which contour it came from, used to prefer continuing along it. */
  contourIndex: number
  used: boolean
}

const EPS = 1e-9

function windingAt(outline: Outline, point: Point): number {
  let winding = 0
  for (const crossing of horizontalCrossings(outline, point.y)) {
    if (crossing.position <= point.x) winding += crossing.winding
  }
  return winding
}

/** Collects every segment of the outline as a cubic. */
function collectCurves(
  outline: Outline,
): Array<{ curve: Cubic; contourIndex: number }> {
  const curves: Array<{ curve: Cubic; contourIndex: number }> = []
  outline.contours.forEach((contour, contourIndex) => {
    for (const segment of contourSegments(contour)) {
      curves.push({ curve: segmentToCubic(segment), contourIndex })
    }
  })
  return curves
}

export interface RemoveOverlapOptions {
  /** Intersection and joining tolerance in font units. */
  tolerance?: number
}

export function removeOverlap(
  outline: Outline,
  options: RemoveOverlapOptions = {},
): Outline {
  const tolerance = options.tolerance ?? 0.05
  const curves = collectCurves(outline)
  if (curves.length < 2) return outline

  // ---- 1. Cut every curve where it meets another --------------------
  const cutParameters: number[][] = curves.map(() => [])
  let found = 0

  for (let i = 0; i < curves.length; i += 1) {
    for (const hit of selfIntersectCubic(curves[i].curve, tolerance)) {
      cutParameters[i].push(hit.t1, hit.t2)
      found += 1
    }
    for (let j = i + 1; j < curves.length; j += 1) {
      const hits = intersectCubics(curves[i].curve, curves[j].curve, tolerance)
      for (const hit of hits) {
        // Segments that merely meet end to end are joins, not crossings.
        if (isJoinHit(curves[i].curve, curves[j].curve, hit, tolerance)) continue
        cutParameters[i].push(hit.t1)
        cutParameters[j].push(hit.t2)
        found += 1
      }
    }
  }

  // Nothing crosses: the outline is already a clean union.
  if (found === 0) return outline

  const pieces: Piece[] = []
  curves.forEach((entry, index) => {
    for (const piece of splitCubicAt(entry.curve, cutParameters[index])) {
      pieces.push({ curve: piece, contourIndex: entry.contourIndex, used: false })
    }
  })

  // ---- 2. Keep the pieces that bound ink -----------------------------
  const step = Math.max(tolerance * 20, 0.25)
  const kept = pieces.filter((piece) => {
    const [p0, c1, c2, p3] = piece.curve
    const mid = cubicAt(p0, c1, c2, p3, 0.5)
    const derivative = cubicDerivativeAt(p0, c1, c2, p3, 0.5)
    const length = Math.hypot(derivative.x, derivative.y)
    if (length < EPS) return false

    // Sample just inside and just outside; a boundary piece has ink on
    // exactly one side.
    const nx = -derivative.y / length
    const ny = derivative.x / length
    const left = windingAt(outline, { x: mid.x + nx * step, y: mid.y + ny * step })
    const right = windingAt(outline, { x: mid.x - nx * step, y: mid.y - ny * step })

    return (left !== 0) !== (right !== 0)
  })

  if (kept.length === 0) return outline

  // ---- 3. Walk the survivors back into contours ----------------------
  const joinTolerance = Math.max(tolerance * 40, 1)
  const contours: Contour[] = []

  for (const start of kept) {
    if (start.used) continue
    start.used = true

    const chain: Cubic[] = [start.curve]
    let end = start.curve[3]
    let guard = 0

    while (guard++ < kept.length * 2) {
      const first = chain[0][0]
      if (Math.hypot(end.x - first.x, end.y - first.y) <= joinTolerance) break

      let best: Piece | null = null
      let bestDistance = joinTolerance
      for (const candidate of kept) {
        if (candidate.used) continue
        const d = Math.hypot(
          candidate.curve[0].x - end.x,
          candidate.curve[0].y - end.y,
        )
        if (d <= bestDistance) {
          best = candidate
          bestDistance = d
        }
      }
      if (!best) break

      best.used = true
      chain.push(best.curve)
      end = best.curve[3]
    }

    if (chain.length < 2) continue

    const nodes = chain.map((curve, index) => {
      const previous = chain[(index - 1 + chain.length) % chain.length]
      return createNode(curve[0].x, curve[0].y, {
        in: { x: previous[2].x, y: previous[2].y },
        out: { x: curve[1].x, y: curve[1].y },
        smooth: false,
      })
    })
    contours.push({ id: createId('c'), nodes, closed: true })
  }

  // A walk that fell apart is worse than leaving the glyph alone.
  if (contours.length === 0) return outline
  return { contours }
}

/** Whether the outline has anything to remove, for enabling the action. */
export function hasOverlap(outline: Outline, tolerance = 0.05): boolean {
  const curves = collectCurves(outline)
  for (let i = 0; i < curves.length; i += 1) {
    if (selfIntersectCubic(curves[i].curve, tolerance).length > 0) return true
    for (let j = i + 1; j < curves.length; j += 1) {
      const hits = intersectCubics(curves[i].curve, curves[j].curve, tolerance, 2)
      for (const hit of hits) {
        if (isJoinHit(curves[i].curve, curves[j].curve, hit, tolerance)) continue
        return true
      }
    }
  }
  return false
}
