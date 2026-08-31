/**
 * Snapping for the glyph canvas.
 *
 * Candidates are expressed in font units and matched against a tolerance
 * given in pixels, so snapping feels equally sticky at every zoom level.
 */
import type { Point } from '@/types/geometry'

export interface SnapTarget {
  value: number
  label: string
  kind: 'metric' | 'node' | 'grid' | 'guide' | 'origin'
}

export interface SnapResult {
  value: number
  target: SnapTarget | null
}

const PRIORITY: Record<SnapTarget['kind'], number> = {
  origin: 0,
  metric: 1,
  guide: 2,
  node: 3,
  grid: 4,
}

/**
 * Snaps one axis. Ties are broken by kind, so a baseline wins over a nearby
 * node and a node wins over the background grid.
 */
export function snapAxis(
  value: number,
  targets: readonly SnapTarget[],
  tolerance: number,
  grid: number,
): SnapResult {
  let best: SnapTarget | null = null
  let bestDistance = tolerance

  for (const target of targets) {
    const distance = Math.abs(target.value - value)
    if (distance > tolerance) continue
    if (
      best === null ||
      distance < bestDistance - 1e-9 ||
      (Math.abs(distance - bestDistance) < 1e-9 &&
        PRIORITY[target.kind] < PRIORITY[best.kind])
    ) {
      best = target
      bestDistance = distance
    }
  }

  if (best) return { value: best.value, target: best }

  if (grid > 0) {
    const snapped = Math.round(value / grid) * grid
    if (Math.abs(snapped - value) <= tolerance) {
      return {
        value: snapped,
        target: { value: snapped, label: `grid ${grid}`, kind: 'grid' },
      }
    }
  }

  return { value, target: null }
}

export interface SnapContext {
  x: SnapTarget[]
  y: SnapTarget[]
  /** Tolerance in font units, derived from a pixel tolerance and the zoom. */
  tolerance: number
  grid: number
}

export function snapPoint(
  point: Point,
  context: SnapContext,
): { point: Point; x: SnapTarget | null; y: SnapTarget | null } {
  const x = snapAxis(point.x, context.x, context.tolerance, context.grid)
  const y = snapAxis(point.y, context.y, context.tolerance, context.grid)
  return {
    point: { x: x.value, y: y.value },
    x: x.target,
    y: y.target,
  }
}
