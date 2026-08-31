/**
 * Outline editing operations.
 *
 * Every function is pure: it takes an outline and returns a new one, leaving
 * the input untouched. That is what lets the history layer store operations
 * rather than snapshots, and it makes each operation directly testable
 * without a canvas.
 */
import type { Contour, Outline, OutlineNode, Point } from '@/types/geometry'
import { createId } from '@/utils/id'
import {
  cloneNode,
  cloneOutline,
  contourSegments,
  createNode,
  nodePoint,
  reverseContour,
} from './outline'
import { closestPointOnCubic, closestPointOnLine, splitCubic } from './bezier'

function mapNodes(
  outline: Outline,
  fn: (node: OutlineNode, contour: Contour, index: number) => OutlineNode,
): Outline {
  return {
    contours: outline.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node, index) => fn(node, contour, index)),
    })),
  }
}

function translatePoint(point: Point | null, dx: number, dy: number): Point | null {
  return point === null ? null : { x: point.x + dx, y: point.y + dy }
}

export function findNode(
  outline: Outline,
  nodeId: string,
): { contourIndex: number; nodeIndex: number; node: OutlineNode } | null {
  for (let c = 0; c < outline.contours.length; c += 1) {
    const nodes = outline.contours[c].nodes
    for (let n = 0; n < nodes.length; n += 1) {
      if (nodes[n].id === nodeId) {
        return { contourIndex: c, nodeIndex: n, node: nodes[n] }
      }
    }
  }
  return null
}

/**
 * Moves whole nodes. Handles travel with their anchor, so the adjoining
 * curves keep their shape and only the moved region changes.
 */
export function moveNodes(
  outline: Outline,
  nodeIds: readonly string[],
  dx: number,
  dy: number,
): Outline {
  if (nodeIds.length === 0 || (dx === 0 && dy === 0)) return outline
  const ids = new Set(nodeIds)
  return mapNodes(outline, (node) => {
    if (!ids.has(node.id)) return node
    return {
      ...node,
      x: node.x + dx,
      y: node.y + dy,
      in: translatePoint(node.in, dx, dy),
      out: translatePoint(node.out, dx, dy),
    }
  })
}

/** Sets node anchors to exact positions, keeping handles relative. */
export function setNodePosition(
  outline: Outline,
  nodeId: string,
  position: Point,
): Outline {
  const found = findNode(outline, nodeId)
  if (!found) return outline
  return moveNodes(outline, [nodeId], position.x - found.node.x, position.y - found.node.y)
}

/**
 * Moves one Bezier handle.
 *
 * On a smooth node the opposite handle is rotated to stay collinear through
 * the anchor, keeping its own length; that is what makes a smooth point stay
 * smooth while being adjusted. `breakSmooth` opts out for one-off tweaks.
 */
export function moveHandle(
  outline: Outline,
  nodeId: string,
  kind: 'in' | 'out',
  position: Point,
  options: { breakSmooth?: boolean } = {},
): Outline {
  const found = findNode(outline, nodeId)
  if (!found) return outline

  return mapNodes(outline, (node) => {
    if (node.id !== nodeId) return node
    const next = cloneNode(node)
    next[kind] = { x: position.x, y: position.y }

    if (options.breakSmooth) {
      next.smooth = false
      return next
    }

    const opposite = kind === 'in' ? 'out' : 'in'
    const other = node[opposite]
    if (node.smooth && other) {
      const dx = position.x - node.x
      const dy = position.y - node.y
      const length = Math.hypot(dx, dy)
      const otherLength = Math.hypot(other.x - node.x, other.y - node.y)
      if (length > 1e-9) {
        next[opposite] = {
          x: node.x - (dx / length) * otherLength,
          y: node.y - (dy / length) * otherLength,
        }
      }
    }
    return next
  })
}

/** Removes a handle, turning the adjoining segment into a straight line. */
export function removeHandle(
  outline: Outline,
  nodeId: string,
  kind: 'in' | 'out',
): Outline {
  return mapNodes(outline, (node) =>
    node.id === nodeId ? { ...cloneNode(node), [kind]: null, smooth: false } : node,
  )
}

/**
 * Marks a node smooth or corner.
 *
 * Turning a node smooth aligns its handles along the average direction of
 * the two segments, which is what a designer expects "make smooth" to do.
 */
export function setNodeSmooth(
  outline: Outline,
  nodeId: string,
  smooth: boolean,
): Outline {
  const found = findNode(outline, nodeId)
  if (!found) return outline
  const { contourIndex, nodeIndex } = found
  const contour = outline.contours[contourIndex]
  const node = contour.nodes[nodeIndex]

  if (!smooth) {
    return mapNodes(outline, (n) => (n.id === nodeId ? { ...cloneNode(n), smooth: false } : n))
  }

  const previous =
    contour.nodes[(nodeIndex - 1 + contour.nodes.length) % contour.nodes.length]
  const next = contour.nodes[(nodeIndex + 1) % contour.nodes.length]

  const before = node.in ?? nodePoint(previous)
  const after = node.out ?? nodePoint(next)

  // Direction through the node, from the incoming side to the outgoing side.
  const dx = after.x - before.x
  const dy = after.y - before.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return outline
  const ux = dx / length
  const uy = dy / length

  const inLength = node.in
    ? Math.hypot(node.in.x - node.x, node.in.y - node.y)
    : Math.hypot(previous.x - node.x, previous.y - node.y) / 3
  const outLength = node.out
    ? Math.hypot(node.out.x - node.x, node.out.y - node.y)
    : Math.hypot(next.x - node.x, next.y - node.y) / 3

  return mapNodes(outline, (n) =>
    n.id === nodeId
      ? {
          ...cloneNode(n),
          smooth: true,
          in: { x: node.x - ux * inLength, y: node.y - uy * inLength },
          out: { x: node.x + ux * outLength, y: node.y + uy * outLength },
        }
      : n,
  )
}

/**
 * Deletes nodes. Contours left with fewer than two nodes are dropped
 * entirely rather than left as degenerate stubs.
 */
export function deleteNodes(
  outline: Outline,
  nodeIds: readonly string[],
): Outline {
  const ids = new Set(nodeIds)
  const contours = outline.contours
    .map((contour) => ({
      ...contour,
      nodes: contour.nodes.filter((node) => !ids.has(node.id)),
    }))
    .filter((contour) => contour.nodes.length >= 2)
  return { contours }
}

export interface SegmentRef {
  contourIndex: number
  segmentIndex: number
}

/**
 * Inserts an on-curve node partway along a segment.
 *
 * Curves are split with de Casteljau, so the outline's shape is bit-for-bit
 * unchanged: the new node lies exactly on the old curve and the four
 * resulting control points reproduce it.
 */
export function insertNode(
  outline: Outline,
  ref: SegmentRef,
  t: number,
): { outline: Outline; nodeId: string | null } {
  const contour = outline.contours[ref.contourIndex]
  if (!contour) return { outline, nodeId: null }

  const segments = contourSegments(contour)
  const segment = segments[ref.segmentIndex]
  if (!segment) return { outline, nodeId: null }

  const clamped = Math.min(0.999, Math.max(0.001, t))
  const fromIndex = ref.segmentIndex
  const toIndex = (ref.segmentIndex + 1) % contour.nodes.length

  const nodes = contour.nodes.map((node) => cloneNode(node))
  let inserted: OutlineNode

  if (segment.kind === 'line') {
    inserted = createNode(
      segment.from.x + (segment.to.x - segment.from.x) * clamped,
      segment.from.y + (segment.to.y - segment.from.y) * clamped,
    )
  } else {
    const { left, right } = splitCubic(
      segment.from,
      segment.c1,
      segment.c2,
      segment.to,
      clamped,
    )
    nodes[fromIndex].out = { x: left[1].x, y: left[1].y }
    nodes[toIndex].in = { x: right[2].x, y: right[2].y }
    inserted = createNode(left[3].x, left[3].y, {
      in: { x: left[2].x, y: left[2].y },
      out: { x: right[1].x, y: right[1].y },
      smooth: true,
    })
  }

  nodes.splice(fromIndex + 1, 0, inserted)

  const contours = [...outline.contours]
  contours[ref.contourIndex] = { ...contour, nodes }
  return { outline: { contours }, nodeId: inserted.id }
}

/** Converts a segment between a straight line and a curve. */
export function setSegmentKind(
  outline: Outline,
  ref: SegmentRef,
  kind: 'line' | 'curve',
): Outline {
  const contour = outline.contours[ref.contourIndex]
  if (!contour) return outline
  const nodes = contour.nodes.map((node) => cloneNode(node))
  const fromIndex = ref.segmentIndex
  const toIndex = (ref.segmentIndex + 1) % nodes.length
  const from = nodes[fromIndex]
  const to = nodes[toIndex]
  if (!from || !to) return outline

  if (kind === 'line') {
    from.out = null
    to.in = null
    from.smooth = false
    to.smooth = false
  } else if (!from.out && !to.in) {
    // Default handles at the classic one-third positions.
    from.out = {
      x: from.x + (to.x - from.x) / 3,
      y: from.y + (to.y - from.y) / 3,
    }
    to.in = {
      x: to.x - (to.x - from.x) / 3,
      y: to.y - (to.y - from.y) / 3,
    }
  }

  const contours = [...outline.contours]
  contours[ref.contourIndex] = { ...contour, nodes }
  return { contours }
}

/** Opens a closed contour at a node, or splits an open one in two. */
export function breakContourAt(outline: Outline, nodeId: string): Outline {
  const found = findNode(outline, nodeId)
  if (!found) return outline
  const { contourIndex, nodeIndex } = found
  const contour = outline.contours[contourIndex]
  const contours = [...outline.contours]

  if (contour.closed) {
    // Re-root the contour at the break point and mark it open.
    const nodes = [
      ...contour.nodes.slice(nodeIndex),
      ...contour.nodes.slice(0, nodeIndex),
    ].map((node) => cloneNode(node))
    const duplicate = cloneNode(nodes[0], false)
    duplicate.out = null
    nodes[0] = { ...nodes[0], in: null }
    nodes.push(duplicate)
    contours[contourIndex] = { ...contour, nodes, closed: false }
    return { contours }
  }

  if (nodeIndex === 0 || nodeIndex === contour.nodes.length - 1) return outline
  const first = contour.nodes.slice(0, nodeIndex + 1).map((n) => cloneNode(n))
  const second = contour.nodes.slice(nodeIndex).map((n) => cloneNode(n, false))
  contours.splice(
    contourIndex,
    1,
    { ...contour, nodes: first, closed: false },
    { id: createId('c'), nodes: second, closed: false },
  )
  return { contours }
}

/**
 * Joins the endpoints of two open contours, or closes one contour when both
 * endpoints belong to it.
 */
export function joinContours(
  outline: Outline,
  nodeIdA: string,
  nodeIdB: string,
): Outline {
  const a = findNode(outline, nodeIdA)
  const b = findNode(outline, nodeIdB)
  if (!a || !b) return outline

  const contourA = outline.contours[a.contourIndex]
  const contourB = outline.contours[b.contourIndex]

  const isEndpoint = (
    contour: Contour,
    index: number,
  ): 'start' | 'end' | null => {
    if (contour.closed) return null
    if (index === 0) return 'start'
    if (index === contour.nodes.length - 1) return 'end'
    return null
  }

  const endA = isEndpoint(contourA, a.nodeIndex)
  const endB = isEndpoint(contourB, b.nodeIndex)
  if (!endA || !endB) return outline

  if (a.contourIndex === b.contourIndex) {
    const contours = [...outline.contours]
    contours[a.contourIndex] = { ...contourA, closed: true }
    return { contours }
  }

  const first = endA === 'end' ? contourA.nodes : [...contourA.nodes].reverse()
  const second = endB === 'start' ? contourB.nodes : [...contourB.nodes].reverse()

  const normalize = (nodes: OutlineNode[], reversed: boolean): OutlineNode[] =>
    reversed
      ? nodes.map((node) => ({
          ...cloneNode(node),
          in: node.out ? { ...node.out } : null,
          out: node.in ? { ...node.in } : null,
        }))
      : nodes.map((node) => cloneNode(node))

  const merged = [
    ...normalize(first, endA !== 'end'),
    ...normalize(second, endB !== 'start'),
  ]

  const contours = outline.contours.filter(
    (_, index) => index !== a.contourIndex && index !== b.contourIndex,
  )
  contours.push({ id: createId('c'), nodes: merged, closed: false })
  return { contours }
}

export function closeContour(outline: Outline, contourIndex: number): Outline {
  const contour = outline.contours[contourIndex]
  if (!contour || contour.closed) return outline
  const contours = [...outline.contours]
  contours[contourIndex] = { ...contour, closed: true }
  return { contours }
}

export function reverseContourAt(outline: Outline, contourIndex: number): Outline {
  const contour = outline.contours[contourIndex]
  if (!contour) return outline
  const contours = [...outline.contours]
  contours[contourIndex] = reverseContour(contour)
  return { contours }
}

export function deleteContour(outline: Outline, contourIndex: number): Outline {
  return {
    contours: outline.contours.filter((_, index) => index !== contourIndex),
  }
}

export function addContour(outline: Outline, contour: Contour): Outline {
  return { contours: [...outline.contours, contour] }
}

export interface HitResult {
  contourIndex: number
  segmentIndex: number
  t: number
  point: Point
  distance: number
}

/** Nearest point on the outline to `target`, for insert and knife tools. */
export function hitTestOutline(
  outline: Outline,
  target: Point,
  maxDistance = Infinity,
): HitResult | null {
  let best: HitResult | null = null

  outline.contours.forEach((contour, contourIndex) => {
    contourSegments(contour).forEach((segment, segmentIndex) => {
      const result =
        segment.kind === 'line'
          ? closestPointOnLine(segment.from, segment.to, target)
          : closestPointOnCubic(
              segment.from,
              segment.c1,
              segment.c2,
              segment.to,
              target,
            )
      if (result.distance > maxDistance) return
      if (best === null || result.distance < best.distance) {
        best = {
          contourIndex,
          segmentIndex,
          t: result.t,
          point: result.point,
          distance: result.distance,
        }
      }
    })
  })

  return best
}

/** Deep copy, used when an edit needs a detached starting point. */
export function copyOutline(outline: Outline): Outline {
  return cloneOutline(outline)
}
