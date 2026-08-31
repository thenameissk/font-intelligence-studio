/**
 * Path operations of the kind a vector editor exposes on its Object and
 * Path menus: aligning and averaging anchors, moving and duplicating whole
 * contours, reordering them, and hit-testing.
 *
 * As everywhere else in the geometry layer these are pure functions over an
 * Outline, so each one is a single undoable command and is testable without
 * a canvas.
 */
import type { Contour, Matrix, Outline, Point } from '@/types/geometry'
import {
  cloneContour,
  cloneNode,
  contourSegments,
  nodePoint,
  outlineBounds,
  reverseContour,
} from './outline'
import { closestPointOnCubic, closestPointOnLine, distance } from './bezier'
import { applyToPoint } from './transform'
import { isPointInside } from './intersect'
import { createId } from '@/utils/id'

// --------------------------------------------------------------------------
// Hit testing
// --------------------------------------------------------------------------

export interface ContourHit {
  contourIndex: number
  contourId: string
  /** True when the point landed on the contour's outline rather than inside. */
  onEdge: boolean
  distance: number
}

/**
 * Finds the contour under a point.
 *
 * The outline is checked first so a click on the edge of a counter picks the
 * counter rather than the shape behind it, then containment, walking from the
 * last contour to the first so the topmost wins.
 */
export function hitTestContours(
  outline: Outline,
  point: Point,
  edgeTolerance: number,
): ContourHit | null {
  let best: ContourHit | null = null

  outline.contours.forEach((contour, contourIndex) => {
    for (const segment of contourSegments(contour)) {
      const result =
        segment.kind === 'line'
          ? closestPointOnLine(segment.from, segment.to, point)
          : closestPointOnCubic(
              segment.from,
              segment.c1,
              segment.c2,
              segment.to,
              point,
            )
      if (result.distance > edgeTolerance) continue
      if (best === null || result.distance < best.distance) {
        best = {
          contourIndex,
          contourId: contour.id,
          onEdge: true,
          distance: result.distance,
        }
      }
    }
  })
  if (best) return best

  for (let index = outline.contours.length - 1; index >= 0; index -= 1) {
    const contour = outline.contours[index]
    if (isPointInside({ contours: [contour] }, point)) {
      return {
        contourIndex: index,
        contourId: contour.id,
        onEdge: false,
        distance: 0,
      }
    }
  }
  return null
}

export function contoursInRect(
  outline: Outline,
  rect: { xMin: number; yMin: number; xMax: number; yMax: number },
): string[] {
  return outline.contours
    .filter((contour) =>
      contour.nodes.every(
        (node) =>
          node.x >= rect.xMin &&
          node.x <= rect.xMax &&
          node.y >= rect.yMin &&
          node.y <= rect.yMax,
      ),
    )
    .map((contour) => contour.id)
}

// --------------------------------------------------------------------------
// Contour-level edits
// --------------------------------------------------------------------------

function mapContours(
  outline: Outline,
  ids: ReadonlySet<string>,
  fn: (contour: Contour) => Contour,
): Outline {
  return {
    contours: outline.contours.map((contour) =>
      ids.has(contour.id) ? fn(contour) : contour,
    ),
  }
}

export function moveContours(
  outline: Outline,
  contourIds: readonly string[],
  dx: number,
  dy: number,
): Outline {
  if (contourIds.length === 0 || (dx === 0 && dy === 0)) return outline
  const ids = new Set(contourIds)
  return mapContours(outline, ids, (contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...cloneNode(node),
      x: node.x + dx,
      y: node.y + dy,
      in: node.in ? { x: node.in.x + dx, y: node.in.y + dy } : null,
      out: node.out ? { x: node.out.x + dx, y: node.out.y + dy } : null,
    })),
  }))
}

export function transformContours(
  outline: Outline,
  contourIds: readonly string[],
  matrix: Matrix,
): Outline {
  const ids = new Set(contourIds)
  return mapContours(outline, ids, (contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => {
      const anchor = applyToPoint(matrix, nodePoint(node))
      return {
        ...cloneNode(node),
        x: anchor.x,
        y: anchor.y,
        in: node.in ? applyToPoint(matrix, node.in) : null,
        out: node.out ? applyToPoint(matrix, node.out) : null,
      }
    }),
  }))
}

/** Transforms only the selected anchors, leaving the rest of the path put. */
export function transformNodes(
  outline: Outline,
  nodeIds: readonly string[],
  matrix: Matrix,
): Outline {
  const ids = new Set(nodeIds)
  return {
    contours: outline.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => {
        if (!ids.has(node.id)) return node
        const anchor = applyToPoint(matrix, nodePoint(node))
        return {
          ...cloneNode(node),
          x: anchor.x,
          y: anchor.y,
          in: node.in ? applyToPoint(matrix, node.in) : null,
          out: node.out ? applyToPoint(matrix, node.out) : null,
        }
      }),
    })),
  }
}

export function duplicateContours(
  outline: Outline,
  contourIds: readonly string[],
  offset: Point = { x: 0, y: 0 },
): { outline: Outline; newIds: string[] } {
  const ids = new Set(contourIds)
  const copies: Contour[] = []
  for (const contour of outline.contours) {
    if (!ids.has(contour.id)) continue
    const copy = cloneContour(contour, false)
    copy.nodes = copy.nodes.map((node) => ({
      ...node,
      x: node.x + offset.x,
      y: node.y + offset.y,
      in: node.in ? { x: node.in.x + offset.x, y: node.in.y + offset.y } : null,
      out: node.out ? { x: node.out.x + offset.x, y: node.out.y + offset.y } : null,
    }))
    copies.push(copy)
  }
  return {
    outline: { contours: [...outline.contours, ...copies] },
    newIds: copies.map((contour) => contour.id),
  }
}

export function deleteContours(
  outline: Outline,
  contourIds: readonly string[],
): Outline {
  const ids = new Set(contourIds)
  return { contours: outline.contours.filter((c) => !ids.has(c.id)) }
}

export function reverseContours(
  outline: Outline,
  contourIds: readonly string[],
): Outline {
  const ids = new Set(contourIds)
  return mapContours(outline, ids, reverseContour)
}

/** Moves a contour in the draw order, which decides what sits on top. */
export function reorderContour(
  outline: Outline,
  contourId: string,
  direction: 'front' | 'forward' | 'backward' | 'back',
): Outline {
  const index = outline.contours.findIndex((c) => c.id === contourId)
  if (index === -1) return outline
  const contours = [...outline.contours]
  const [contour] = contours.splice(index, 1)
  const target =
    direction === 'front'
      ? contours.length
      : direction === 'back'
        ? 0
        : direction === 'forward'
          ? Math.min(contours.length, index + 1)
          : Math.max(0, index - 1)
  contours.splice(target, 0, contour)
  return { contours }
}

/** Adds a ready-made contour, used by the pen tool and paste. */
export function appendContours(
  outline: Outline,
  contours: readonly Contour[],
): Outline {
  return { contours: [...outline.contours, ...contours.map((c) => cloneContour(c, false))] }
}

// --------------------------------------------------------------------------
// Anchor-level edits
// --------------------------------------------------------------------------

export const NODE_ALIGN = {
  Left: 'left',
  HorizontalCenter: 'h-center',
  Right: 'right',
  Top: 'top',
  VerticalCenter: 'v-center',
  Bottom: 'bottom',
} as const
export type NodeAlign = (typeof NODE_ALIGN)[keyof typeof NODE_ALIGN]

/** Aligns the selected anchors to one edge of their shared bounding box. */
export function alignNodes(
  outline: Outline,
  nodeIds: readonly string[],
  alignment: NodeAlign,
): Outline {
  const ids = new Set(nodeIds)
  const selected = outline.contours
    .flatMap((c) => c.nodes)
    .filter((node) => ids.has(node.id))
  if (selected.length < 2) return outline

  const xs = selected.map((n) => n.x)
  const ys = selected.map((n) => n.y)
  const target = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    'h-center': (Math.min(...xs) + Math.max(...xs)) / 2,
    bottom: Math.min(...ys),
    top: Math.max(...ys),
    'v-center': (Math.min(...ys) + Math.max(...ys)) / 2,
  }[alignment]

  const horizontal =
    alignment === NODE_ALIGN.Left ||
    alignment === NODE_ALIGN.Right ||
    alignment === NODE_ALIGN.HorizontalCenter

  return {
    contours: outline.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => {
        if (!ids.has(node.id)) return node
        const dx = horizontal ? target - node.x : 0
        const dy = horizontal ? 0 : target - node.y
        return {
          ...cloneNode(node),
          x: node.x + dx,
          y: node.y + dy,
          in: node.in ? { x: node.in.x + dx, y: node.in.y + dy } : null,
          out: node.out ? { x: node.out.x + dx, y: node.out.y + dy } : null,
        }
      }),
    })),
  }
}

/**
 * Averages the selected anchors onto a common position, the operation an
 * editor calls "Average". Averaging both axes collapses them to one point,
 * which is what you do just before joining two endpoints.
 */
export function averageNodes(
  outline: Outline,
  nodeIds: readonly string[],
  axis: 'x' | 'y' | 'both',
): Outline {
  const ids = new Set(nodeIds)
  const selected = outline.contours
    .flatMap((c) => c.nodes)
    .filter((node) => ids.has(node.id))
  if (selected.length < 2) return outline

  const meanX = selected.reduce((sum, n) => sum + n.x, 0) / selected.length
  const meanY = selected.reduce((sum, n) => sum + n.y, 0) / selected.length

  return {
    contours: outline.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => {
        if (!ids.has(node.id)) return node
        const dx = axis === 'y' ? 0 : meanX - node.x
        const dy = axis === 'x' ? 0 : meanY - node.y
        return {
          ...cloneNode(node),
          x: node.x + dx,
          y: node.y + dy,
          in: node.in ? { x: node.in.x + dx, y: node.in.y + dy } : null,
          out: node.out ? { x: node.out.x + dx, y: node.out.y + dy } : null,
        }
      }),
    })),
  }
}

/** Endpoints of open contours, which are the only joinable anchors. */
export function openEndpoints(
  outline: Outline,
): Array<{ contourIndex: number; nodeId: string; end: 'start' | 'end' }> {
  const result: Array<{
    contourIndex: number
    nodeId: string
    end: 'start' | 'end'
  }> = []
  outline.contours.forEach((contour, contourIndex) => {
    if (contour.closed || contour.nodes.length === 0) return
    result.push({ contourIndex, nodeId: contour.nodes[0].id, end: 'start' })
    result.push({
      contourIndex,
      nodeId: contour.nodes[contour.nodes.length - 1].id,
      end: 'end',
    })
  })
  return result
}

/** Nearest open endpoint to a point, for the pen tool's close/continue. */
export function nearestEndpoint(
  outline: Outline,
  point: Point,
  tolerance: number,
): { contourIndex: number; nodeId: string; end: 'start' | 'end' } | null {
  let best: {
    contourIndex: number
    nodeId: string
    end: 'start' | 'end'
    distance: number
  } | null = null

  for (const endpoint of openEndpoints(outline)) {
    const contour = outline.contours[endpoint.contourIndex]
    const node = contour.nodes.find((n) => n.id === endpoint.nodeId)
    if (!node) continue
    const d = distance(nodePoint(node), point)
    if (d > tolerance) continue
    if (best === null || d < best.distance) best = { ...endpoint, distance: d }
  }
  return best
}

/** Bounding box of a set of anchors, for the transform box. */
export function nodesBounds(
  outline: Outline,
  nodeIds: readonly string[],
): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  const ids = new Set(nodeIds)
  const selected = outline.contours
    .flatMap((c) => c.nodes)
    .filter((node) => ids.has(node.id))
  if (selected.length === 0) return null
  const xs = selected.map((n) => n.x)
  const ys = selected.map((n) => n.y)
  return {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  }
}

export function contoursBounds(
  outline: Outline,
  contourIds: readonly string[],
): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  const ids = new Set(contourIds)
  const selected = outline.contours.filter((c) => ids.has(c.id))
  if (selected.length === 0) return null
  return outlineBounds({ contours: selected })
}

/** Builds a contour from a list of points, used by paste and the pen tool. */
export function contourFromPoints(
  points: readonly Point[],
  closed: boolean,
): Contour {
  return {
    id: createId('c'),
    closed,
    nodes: points.map((point) => cloneNode({
      id: createId('n'),
      x: point.x,
      y: point.y,
      in: null,
      out: null,
      smooth: false,
    })),
  }
}
