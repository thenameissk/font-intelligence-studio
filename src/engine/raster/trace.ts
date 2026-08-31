/**
 * Contour tracing by marching squares.
 *
 * The image is treated as a sampled scalar field and the boundary is taken
 * as the iso-line where inkness crosses the threshold. Crossings are placed
 * by linear interpolation between neighbouring samples, so the result is
 * sub-pixel accurate: the difference between a curve that fits nicely and a
 * staircase that no amount of smoothing will rescue.
 */
import type { Point } from '@/types/geometry'

export interface TraceOptions {
  /** Contour level in the field, typically from `inkField`. */
  isoLevel?: number
  /** Drop loops shorter than this many points. */
  minPoints?: number
  /** Drop loops enclosing less than this fraction of the image. */
  minAreaFraction?: number
}

export interface TracedPolygon {
  /** Closed ring, in image coordinates with y running downwards. */
  points: Point[]
  /** Positive when the ring winds counter-clockwise in image space. */
  signedArea: number
}

/**
 * Which cell edges the boundary crosses, per marching-squares case.
 *
 * Each case lists the segments to emit as [entryEdge, exitEdge], where edges
 * are numbered 0 top, 1 right, 2 bottom, 3 left.
 */
const CASE_SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [], // 0000
  [[2, 3]], // 0001 bottom-left
  [[1, 2]], // 0010 bottom-right
  [[1, 3]], // 0011
  [[0, 1]], // 0100 top-right
  [
    [0, 3],
    [1, 2],
  ], // 0101 saddle
  [[0, 2]], // 0110
  [[0, 3]], // 0111
  [[3, 0]], // 1000 top-left
  [[2, 0]], // 1001
  [
    [3, 2],
    [1, 0],
  ], // 1010 saddle
  [[1, 0]], // 1011
  [[3, 1]], // 1100
  [[2, 1]], // 1101
  [[3, 2]], // 1110
  [], // 1111
]

function interpolate(a: number, b: number, iso: number): number {
  const denominator = b - a
  if (Math.abs(denominator) < 1e-9) return 0.5
  return Math.max(0, Math.min(1, (iso - a) / denominator))
}

/** Sub-pixel position of the crossing on one edge of a cell. */
function edgePoint(
  edge: number,
  x: number,
  y: number,
  corners: readonly [number, number, number, number],
  iso: number,
): Point {
  const [tl, tr, br, bl] = corners
  switch (edge) {
    case 0:
      return { x: x + interpolate(tl, tr, iso), y }
    case 1:
      return { x: x + 1, y: y + interpolate(tr, br, iso) }
    case 2:
      return { x: x + interpolate(bl, br, iso), y: y + 1 }
    default:
      return { x, y: y + interpolate(tl, bl, iso) }
  }
}

function keyOf(x: number, y: number, edge: number): string {
  return `${x},${y},${edge}`
}

/** The cell on the far side of an edge, and that edge's index there. */
function step(
  x: number,
  y: number,
  edge: number,
): { x: number; y: number; edge: number } {
  switch (edge) {
    case 0:
      return { x, y: y - 1, edge: 2 }
    case 1:
      return { x: x + 1, y, edge: 3 }
    case 2:
      return { x, y: y + 1, edge: 0 }
    default:
      return { x: x - 1, y, edge: 1 }
  }
}

export function polygonArea(points: readonly Point[]): number {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += (a.x * b.y - b.x * a.y) / 2
  }
  return area
}

/**
 * Traces every closed boundary in the field.
 *
 * Segments are emitted per cell and then chained: each segment's exit edge
 * is shared with exactly one neighbouring cell's entry edge, so following
 * them walks a complete loop and every loop is found exactly once.
 */
export function traceContours(
  field: Float32Array,
  width: number,
  height: number,
  options: TraceOptions = {},
): TracedPolygon[] {
  const iso = options.isoLevel ?? 0.5
  const minPoints = options.minPoints ?? 8
  const minAreaFraction = options.minAreaFraction ?? 0.0002

  const sample = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0
    return field[y * width + x]
  }

  // Segment lookup: from an entry edge in a cell, where does it leave?
  const exits = new Map<string, { x: number; y: number; edge: number }>()
  const cellCorners = new Map<
    string,
    readonly [number, number, number, number]
  >()

  // One cell past the image on each side, so shapes touching the border close.
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const tl = sample(x, y)
      const tr = sample(x + 1, y)
      const br = sample(x + 1, y + 1)
      const bl = sample(x, y + 1)

      const code =
        (tl >= iso ? 8 : 0) |
        (tr >= iso ? 4 : 0) |
        (br >= iso ? 2 : 0) |
        (bl >= iso ? 1 : 0)

      const segments = CASE_SEGMENTS[code]
      if (segments.length === 0) continue

      const corners = [tl, tr, br, bl] as const
      cellCorners.set(`${x},${y}`, corners)
      for (const [entry, exit] of segments) {
        exits.set(keyOf(x, y, entry), { x, y, edge: exit })
      }
    }
  }

  const visited = new Set<string>()
  const polygons: TracedPolygon[] = []
  const imageArea = Math.max(1, width * height)

  for (const startKey of exits.keys()) {
    if (visited.has(startKey)) continue

    const points: Point[] = []
    let current = startKey
    let guard = 0
    const limit = exits.size * 2 + 16

    while (guard++ < limit) {
      if (visited.has(current)) break
      visited.add(current)

      const [cx, cy, centry] = current.split(',').map(Number)
      const exit = exits.get(current)
      if (!exit) break

      const corners = cellCorners.get(`${cx},${cy}`)
      if (!corners) break
      points.push(edgePoint(exit.edge, cx, cy, corners, iso))
      void centry

      const next = step(exit.x, exit.y, exit.edge)
      current = keyOf(next.x, next.y, next.edge)
      if (current === startKey) break
    }

    if (points.length < minPoints) continue
    const area = polygonArea(points)
    if (Math.abs(area) / imageArea < minAreaFraction) continue
    polygons.push({ points, signedArea: area })
  }

  return polygons
}
