/**
 * Corner rounding.
 *
 * A corner is replaced with a circular fillet of the requested radius: the
 * adjacent segments are trimmed back by r*tan(a/2) where a is the angle the
 * tangent turns through, and the gap is bridged by the cubic that best
 * approximates that arc (handle length (4/3)*tan(a/4)*r, which is exact for
 * a circular arc).
 *
 * Radii are clamped so a fillet can never eat more than its share of the
 * neighbouring segments, which is what keeps small counters intact.
 */
import type { Contour, Outline, OutlineNode, Point, Segment } from '@/types/geometry'
import {
  contourSegments,
  createNode,
  nodePoint,
} from '@/engine/geometry/outline'
import {
  cubicAt,
  cubicDerivativeAt,
  distance as pointDistance,
  flattenCubic,
  splitCubic,
} from '@/engine/geometry/bezier'
import { createId } from '@/utils/id'

const EPS = 1e-9

function normalize(v: Point): Point {
  const length = Math.hypot(v.x, v.y)
  return length < EPS ? { x: 0, y: 0 } : { x: v.x / length, y: v.y / length }
}

function segmentLength(segment: Segment): number {
  if (segment.kind === 'line') return pointDistance(segment.from, segment.to)
  let total = 0
  let previous = segment.from
  for (const point of flattenCubic(segment.from, segment.c1, segment.c2, segment.to, 0.1)) {
    total += pointDistance(previous, point)
    previous = point
  }
  return total
}

/** Parameter at a given arc distance from the start (or end) of a segment. */
function paramAtDistance(
  segment: Segment,
  distance: number,
  fromEnd: boolean,
): number {
  if (segment.kind === 'line') {
    const length = pointDistance(segment.from, segment.to)
    if (length < EPS) return fromEnd ? 1 : 0
    const t = distance / length
    return fromEnd ? 1 - t : t
  }
  const steps = 64
  let travelled = 0
  let previous = segment.from
  const target = distance
  for (let i = 1; i <= steps; i += 1) {
    const t = fromEnd ? 1 - i / steps : i / steps
    const point = cubicAt(segment.from, segment.c1, segment.c2, segment.to, t)
    travelled += pointDistance(previous, point)
    previous = point
    if (travelled >= target) return t
  }
  return fromEnd ? 0 : 1
}

function tangentAt(segment: Segment, t: number): Point {
  if (segment.kind === 'line') {
    return normalize({
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y,
    })
  }
  return normalize(
    cubicDerivativeAt(segment.from, segment.c1, segment.c2, segment.to, t),
  )
}

/** Sub-segment of `segment` between parameters t0 and t1. */
function subSegment(segment: Segment, t0: number, t1: number): Segment {
  if (segment.kind === 'line') {
    const at = (t: number): Point => ({
      x: segment.from.x + (segment.to.x - segment.from.x) * t,
      y: segment.from.y + (segment.to.y - segment.from.y) * t,
    })
    return { kind: 'line', from: at(t0), to: at(t1) }
  }
  const right = splitCubic(segment.from, segment.c1, segment.c2, segment.to, t0).right
  const remaining = t1 <= t0 ? 0 : (t1 - t0) / (1 - t0)
  const left = splitCubic(right[0], right[1], right[2], right[3], Math.min(1, remaining)).left
  return { kind: 'cubic', from: left[0], c1: left[1], c2: left[2], to: left[3] }
}

export interface RoundCornersOptions {
  radius: number
  /** Corners turning less than this many degrees are left alone. */
  minAngle?: number
  /** Corners turning more than this are treated as spikes and skipped. */
  maxAngle?: number
  /** Restrict to these node ids; all corners when omitted. */
  nodeIds?: ReadonlySet<string>
}

interface CornerPlan {
  round: boolean
  /** Parameter on the incoming segment where the fillet starts. */
  tIn: number
  /** Parameter on the outgoing segment where the fillet ends. */
  tOut: number
  handleLength: number
}

export function roundContourCorners(
  contour: Contour,
  options: RoundCornersOptions,
): Contour {
  const { radius } = options
  const minAngle = options.minAngle ?? 25
  const maxAngle = options.maxAngle ?? 175
  if (radius <= 0 || contour.nodes.length < 3) return contour

  const segments = contourSegments(contour)
  if (segments.length < 2) return contour

  const count = contour.nodes.length
  const lengths = segments.map(segmentLength)
  const plans: CornerPlan[] = []

  for (let i = 0; i < count; i += 1) {
    const node = contour.nodes[i]
    const incoming = contour.closed ? segments[(i - 1 + count) % count] : segments[i - 1]
    const outgoing = contour.closed ? segments[i] : segments[i]

    const skip = (): CornerPlan => ({ round: false, tIn: 1, tOut: 0, handleLength: 0 })

    if (!incoming || !outgoing) {
      plans.push(skip())
      continue
    }
    if (options.nodeIds && !options.nodeIds.has(node.id)) {
      plans.push(skip())
      continue
    }

    const u = tangentAt(incoming, 1)
    const v = tangentAt(outgoing, 0)
    const cross = u.x * v.y - u.y * v.x
    const dot = u.x * v.x + u.y * v.y
    const turn = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI)

    if (turn < minAngle || turn > maxAngle) {
      plans.push(skip())
      continue
    }

    const alpha = (turn * Math.PI) / 180
    let trim = radius * Math.tan(alpha / 2)

    // Never consume more than 45% of either neighbour.
    const inIndex = contour.closed ? (i - 1 + count) % count : i - 1
    const outIndex = i
    trim = Math.min(trim, lengths[inIndex] * 0.45, lengths[outIndex] * 0.45)
    if (trim < 1e-4) {
      plans.push(skip())
      continue
    }

    const effectiveRadius = trim / Math.tan(alpha / 2)
    plans.push({
      round: true,
      tIn: paramAtDistance(incoming, trim, true),
      tOut: paramAtDistance(outgoing, trim, false),
      handleLength: (4 / 3) * Math.tan(alpha / 4) * effectiveRadius,
    })
  }

  if (!plans.some((plan) => plan.round)) return contour

  // Rebuild as a list of pieces: each segment trimmed back by the corners
  // either side of it, with a fillet arc inserted between the trimmed ends.
  interface Piece {
    from: Point
    c1: Point | null
    c2: Point | null
    to: Point
    smoothStart: boolean
  }

  const pieces: Piece[] = []
  const segmentCount = contour.closed ? count : count - 1

  const pushSegment = (piece: Segment, smoothStart: boolean): void => {
    pieces.push({
      from: piece.from,
      c1: piece.kind === 'cubic' ? piece.c1 : null,
      c2: piece.kind === 'cubic' ? piece.c2 : null,
      to: piece.to,
      smoothStart,
    })
  }

  for (let i = 0; i < segmentCount; i += 1) {
    const startPlan = plans[i]
    const endPlan = plans[(i + 1) % count]
    const t0 = startPlan.round ? startPlan.tOut : 0
    const t1 = endPlan.round ? endPlan.tIn : 1
    if (t1 <= t0 + 1e-9) continue

    pushSegment(
      subSegment(segments[i], t0, t1),
      startPlan.round ? true : contour.nodes[i].smooth,
    )

    if (!endPlan.round) continue

    // Fillet from the end of this segment to the start of the next one.
    const nextIndex = (i + 1) % segmentCount
    const nextPlan = plans[(i + 1) % count]
    const nextStart = subSegment(
      segments[nextIndex],
      nextPlan.round ? nextPlan.tOut : 0,
      1,
    ).from

    const endTangent = tangentAt(segments[i], t1)
    const nextTangent = tangentAt(segments[nextIndex], nextPlan.tOut)
    const filletFrom = subSegment(segments[i], t0, t1).to
    const length = endPlan.handleLength

    pieces.push({
      from: filletFrom,
      c1: {
        x: filletFrom.x + endTangent.x * length,
        y: filletFrom.y + endTangent.y * length,
      },
      c2: {
        x: nextStart.x - nextTangent.x * length,
        y: nextStart.y - nextTangent.y * length,
      },
      to: nextStart,
      smoothStart: true,
    })
  }

  if (pieces.length < 3) return contour

  const nodes: OutlineNode[] = pieces.map((piece, index) => {
    const previous = pieces[(index - 1 + pieces.length) % pieces.length]
    return createNode(piece.from.x, piece.from.y, {
      in: previous.c2 ? { ...previous.c2 } : null,
      out: piece.c1 ? { ...piece.c1 } : null,
      smooth: piece.smoothStart,
    })
  })

  return { id: createId('c'), nodes, closed: contour.closed }
}

export function roundCorners(
  outline: Outline,
  options: RoundCornersOptions,
): Outline {
  return {
    contours: outline.contours.map((contour) =>
      roundContourCorners(contour, options),
    ),
  }
}

/** Corner nodes eligible for rounding, for previews and counts. */
export function findCorners(
  outline: Outline,
  minAngle = 25,
  maxAngle = 175,
): Array<{ contourIndex: number; nodeIndex: number; nodeId: string; angle: number; point: Point }> {
  const result: Array<{
    contourIndex: number
    nodeIndex: number
    nodeId: string
    angle: number
    point: Point
  }> = []

  outline.contours.forEach((contour, contourIndex) => {
    const segments = contourSegments(contour)
    const count = contour.nodes.length
    contour.nodes.forEach((node, nodeIndex) => {
      const incoming = contour.closed
        ? segments[(nodeIndex - 1 + count) % count]
        : segments[nodeIndex - 1]
      const outgoing = segments[nodeIndex]
      if (!incoming || !outgoing) return
      const u = tangentAt(incoming, 1)
      const v = tangentAt(outgoing, 0)
      const cross = u.x * v.y - u.y * v.x
      const dot = u.x * v.x + u.y * v.y
      const angle = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI)
      if (angle >= minAngle && angle <= maxAngle) {
        result.push({
          contourIndex,
          nodeIndex,
          nodeId: node.id,
          angle,
          point: nodePoint(node),
        })
      }
    })
  })

  return result
}
