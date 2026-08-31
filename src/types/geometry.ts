/**
 * Geometry primitives for glyph outlines.
 *
 * The editable outline model is a node/handle model (as used by Glyphs, FontLab
 * and Figma) rather than a raw command list:
 *
 *   - Every node is an ON-CURVE anchor point.
 *   - `in` is the incoming (previous-segment) control handle, `out` the
 *     outgoing (next-segment) control handle. Both are ABSOLUTE coordinates,
 *     or `null` when the adjacent segment is a straight line.
 *   - The segment from node[i] to node[i+1] is a cubic Bezier when either
 *     node[i].out or node[i+1].in is present, otherwise a line.
 *
 * All coordinates are in font units (em units), y-up, baseline at y=0 --
 * the same space the font file uses. Screen conversion happens only in the
 * rendering layer.
 */

export interface Point {
  x: number
  y: number
}

/** Matrix in the order [a, b, c, d, e, f] => x' = ax + cy + e, y' = bx + dy + f */
export type Matrix = readonly [number, number, number, number, number, number]

export interface Rect {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

export interface OutlineNode {
  /** Stable identity, used by selection + undo/redo. */
  id: string
  /** On-curve anchor point. */
  x: number
  y: number
  /** Incoming control handle (absolute), null for a line segment before. */
  in: Point | null
  /** Outgoing control handle (absolute), null for a line segment after. */
  out: Point | null
  /** When true, `in`/`out` are kept collinear through the anchor. */
  smooth: boolean
}

export interface Contour {
  id: string
  nodes: OutlineNode[]
  /** Font outlines are effectively always closed; open contours are an error. */
  closed: boolean
}

export interface Outline {
  contours: Contour[]
}

/** Reference to a component glyph inside a composite glyph. */
export interface GlyphComponent {
  glyphIndex: number
  transform: Matrix
}

export const CONTOUR_DIRECTION = {
  Clockwise: 'cw',
  CounterClockwise: 'ccw',
  Degenerate: 'degenerate',
} as const

export type ContourDirection =
  (typeof CONTOUR_DIRECTION)[keyof typeof CONTOUR_DIRECTION]

/** A single drawable segment, derived from adjacent nodes. */
export type Segment =
  | { kind: 'line'; from: Point; to: Point }
  | { kind: 'cubic'; from: Point; c1: Point; c2: Point; to: Point }
