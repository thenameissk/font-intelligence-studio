/**
 * The editable outline model and its conversions.
 *
 * `Outline` is the single source of truth for glyph geometry while editing.
 * It converts losslessly to and from opentype.js path commands (quadratics
 * are widened to cubics on the way in, which is exact).
 */
import type { PathCommand } from 'opentype.js'
import type {
  Contour,
  ContourDirection,
  Outline,
  OutlineNode,
  Point,
  Rect,
  Segment,
} from '@/types/geometry'
import { CONTOUR_DIRECTION } from '@/types/geometry'
import { createId } from '@/utils/id'
import {
  cubicBounds,
  cubicChordArea,
  cubicLength,
  distance,
  EPSILON,
  pointsEqual,
  quadraticToCubic,
} from './bezier'

export const EMPTY_OUTLINE: Outline = { contours: [] }

export function createNode(
  x: number,
  y: number,
  options: Partial<Pick<OutlineNode, 'in' | 'out' | 'smooth' | 'id'>> = {},
): OutlineNode {
  return {
    id: options.id ?? createId('n'),
    x,
    y,
    in: options.in ?? null,
    out: options.out ?? null,
    smooth: options.smooth ?? false,
  }
}

export function nodePoint(node: OutlineNode): Point {
  return { x: node.x, y: node.y }
}

export function cloneNode(node: OutlineNode, keepId = true): OutlineNode {
  return {
    id: keepId ? node.id : createId('n'),
    x: node.x,
    y: node.y,
    in: node.in ? { ...node.in } : null,
    out: node.out ? { ...node.out } : null,
    smooth: node.smooth,
  }
}

export function cloneContour(contour: Contour, keepIds = true): Contour {
  return {
    id: keepIds ? contour.id : createId('c'),
    closed: contour.closed,
    nodes: contour.nodes.map((n) => cloneNode(n, keepIds)),
  }
}

export function cloneOutline(outline: Outline, keepIds = true): Outline {
  return { contours: outline.contours.map((c) => cloneContour(c, keepIds)) }
}

/** True when the handles either side of the anchor are collinear. */
export function isNodeSmooth(node: OutlineNode, toleranceDeg = 1.5): boolean {
  if (!node.in || !node.out) return false
  const ax = node.x - node.in.x
  const ay = node.y - node.in.y
  const bx = node.out.x - node.x
  const by = node.out.y - node.y
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  if (la < EPSILON || lb < EPSILON) return false
  const cos = (ax * bx + ay * by) / (la * lb)
  const angle = Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI)
  return angle <= toleranceDeg
}

// --------------------------------------------------------------------------
// Path commands -> Outline
// --------------------------------------------------------------------------

/**
 * Converts opentype.js path commands into the node model.
 *
 * The final on-curve point of a closed contour is normally a duplicate of
 * the start point; it is merged into the start node so that the closing
 * segment keeps its handles.
 */
export function commandsToOutline(commands: readonly PathCommand[]): Outline {
  const contours: Contour[] = []
  let nodes: OutlineNode[] = []
  let current: Point | null = null

  const finish = (closed: boolean): void => {
    if (nodes.length === 0) return
    if (closed && nodes.length > 1) {
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (pointsEqual(nodePoint(first), nodePoint(last), 1e-6)) {
        first.in = last.in
        nodes.pop()
      }
    }
    for (const node of nodes) node.smooth = isNodeSmooth(node)
    contours.push({ id: createId('c'), nodes, closed })
    nodes = []
  }

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        finish(false)
        current = { x: cmd.x, y: cmd.y }
        nodes.push(createNode(cmd.x, cmd.y))
        break
      }
      case 'L': {
        if (!current) break
        // opentype.js emits redundant zero-length lines when it walks a
        // TrueType contour (an `L` back to the point it just reached).
        // They carry no geometry and would otherwise show up as duplicate
        // nodes in every glyph.
        if (pointsEqual(current, { x: cmd.x, y: cmd.y }, 1e-9)) break
        current = { x: cmd.x, y: cmd.y }
        nodes.push(createNode(cmd.x, cmd.y))
        break
      }
      case 'C': {
        if (!current || nodes.length === 0) break
        nodes[nodes.length - 1].out = { x: cmd.x1, y: cmd.y1 }
        nodes.push(
          createNode(cmd.x, cmd.y, { in: { x: cmd.x2, y: cmd.y2 } }),
        )
        current = { x: cmd.x, y: cmd.y }
        break
      }
      case 'Q': {
        if (!current || nodes.length === 0) break
        const end = { x: cmd.x, y: cmd.y }
        const { c1, c2 } = quadraticToCubic(current, { x: cmd.x1, y: cmd.y1 }, end)
        nodes[nodes.length - 1].out = c1
        nodes.push(createNode(end.x, end.y, { in: c2 }))
        current = end
        break
      }
      case 'Z': {
        finish(true)
        current = null
        break
      }
    }
  }
  finish(false)

  return { contours: contours.filter((c) => c.nodes.length > 0) }
}

// --------------------------------------------------------------------------
// Outline -> path commands
// --------------------------------------------------------------------------

export function outlineToCommands(outline: Outline): PathCommand[] {
  const commands: PathCommand[] = []
  for (const contour of outline.contours) {
    const { nodes } = contour
    if (nodes.length === 0) continue
    commands.push({ type: 'M', x: nodes[0].x, y: nodes[0].y })

    const segmentCount = contour.closed ? nodes.length : nodes.length - 1
    for (let i = 0; i < segmentCount; i += 1) {
      const from = nodes[i]
      const to = nodes[(i + 1) % nodes.length]
      const isClosingSegment = contour.closed && i === segmentCount - 1
      if (isClosingSegment && !from.out && !to.in) {
        // `Z` already draws a straight line back to the start point.
        continue
      }
      if (from.out || to.in) {
        commands.push({
          type: 'C',
          x1: from.out?.x ?? from.x,
          y1: from.out?.y ?? from.y,
          x2: to.in?.x ?? to.x,
          y2: to.in?.y ?? to.y,
          x: to.x,
          y: to.y,
        })
      } else {
        commands.push({ type: 'L', x: to.x, y: to.y })
      }
    }
    if (contour.closed) commands.push({ type: 'Z' })
  }
  return commands
}

export function outlineToSvgPathData(outline: Outline, precision = 2): string {
  const round = (value: number): string => {
    const rounded = Number(value.toFixed(precision))
    return String(Object.is(rounded, -0) ? 0 : rounded)
  }
  const parts: string[] = []
  for (const cmd of outlineToCommands(outline)) {
    switch (cmd.type) {
      case 'M':
        parts.push(`M${round(cmd.x)} ${round(cmd.y)}`)
        break
      case 'L':
        parts.push(`L${round(cmd.x)} ${round(cmd.y)}`)
        break
      case 'C':
        parts.push(
          `C${round(cmd.x1)} ${round(cmd.y1)} ${round(cmd.x2)} ${round(cmd.y2)} ${round(cmd.x)} ${round(cmd.y)}`,
        )
        break
      case 'Q':
        parts.push(`Q${round(cmd.x1)} ${round(cmd.y1)} ${round(cmd.x)} ${round(cmd.y)}`)
        break
      case 'Z':
        parts.push('Z')
        break
    }
  }
  return parts.join('')
}

// --------------------------------------------------------------------------
// Segments, bounds, direction
// --------------------------------------------------------------------------

export function contourSegments(contour: Contour): Segment[] {
  const { nodes } = contour
  const segments: Segment[] = []
  const count = contour.closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < count; i += 1) {
    const from = nodes[i]
    const to = nodes[(i + 1) % nodes.length]
    if (from.out || to.in) {
      segments.push({
        kind: 'cubic',
        from: nodePoint(from),
        c1: from.out ?? nodePoint(from),
        c2: to.in ?? nodePoint(to),
        to: nodePoint(to),
      })
    } else {
      segments.push({ kind: 'line', from: nodePoint(from), to: nodePoint(to) })
    }
  }
  return segments
}

export function outlineSegments(outline: Outline): Segment[] {
  return outline.contours.flatMap(contourSegments)
}

export const EMPTY_RECT: Rect = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  }
}

export function segmentBounds(segment: Segment): Rect {
  if (segment.kind === 'line') {
    return {
      xMin: Math.min(segment.from.x, segment.to.x),
      xMax: Math.max(segment.from.x, segment.to.x),
      yMin: Math.min(segment.from.y, segment.to.y),
      yMax: Math.max(segment.from.y, segment.to.y),
    }
  }
  return cubicBounds(segment.from, segment.c1, segment.c2, segment.to)
}

export function outlineBounds(outline: Outline): Rect {
  let result: Rect | null = null
  for (const contour of outline.contours) {
    for (const segment of contourSegments(contour)) {
      const bounds = segmentBounds(segment)
      result = result === null ? bounds : unionRect(result, bounds)
    }
    if (result === null && contour.nodes.length === 1) {
      const n = contour.nodes[0]
      result = { xMin: n.x, yMin: n.y, xMax: n.x, yMax: n.y }
    }
  }
  return result ?? EMPTY_RECT
}

export function isOutlineEmpty(outline: Outline): boolean {
  return outline.contours.every((c) => c.nodes.length === 0)
}

/**
 * Signed area, counter-clockwise positive in the font's y-up space.
 * Computed as the anchor polygon's shoelace area plus each curve's
 * chord-relative area, which is exact for cubics.
 */
export function contourSignedArea(contour: Contour): number {
  const { nodes } = contour
  if (nodes.length < 2) return 0
  let area = 0
  const count = contour.closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < count; i += 1) {
    const a = nodes[i]
    const b = nodes[(i + 1) % nodes.length]
    area += (a.x * b.y - b.x * a.y) / 2
  }
  for (const segment of contourSegments(contour)) {
    if (segment.kind === 'cubic') {
      area += cubicChordArea(segment.from, segment.c1, segment.c2, segment.to)
    }
  }
  return area
}

export function contourDirection(contour: Contour): ContourDirection {
  const area = contourSignedArea(contour)
  if (Math.abs(area) < 1e-6) return CONTOUR_DIRECTION.Degenerate
  return area > 0
    ? CONTOUR_DIRECTION.CounterClockwise
    : CONTOUR_DIRECTION.Clockwise
}

export function reverseContour(contour: Contour): Contour {
  const reversed = [...contour.nodes].reverse().map((node) => ({
    ...cloneNode(node),
    in: node.out ? { ...node.out } : null,
    out: node.in ? { ...node.in } : null,
  }))
  // Reversing puts the start node at the end for closed contours; rotate back.
  if (contour.closed && reversed.length > 1) {
    reversed.unshift(reversed.pop()!)
  }
  return { ...contour, nodes: reversed }
}

export function contourPerimeter(contour: Contour): number {
  let total = 0
  for (const segment of contourSegments(contour)) {
    total +=
      segment.kind === 'line'
        ? distance(segment.from, segment.to)
        : cubicLength(segment.from, segment.c1, segment.c2, segment.to)
  }
  return total
}

export function countNodes(outline: Outline): number {
  return outline.contours.reduce((sum, c) => sum + c.nodes.length, 0)
}
