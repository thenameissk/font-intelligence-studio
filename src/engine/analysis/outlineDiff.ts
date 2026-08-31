/**
 * Where two glyphs differ, and what to call those places.
 *
 * This drives the annotated comparison: the circles and labels that point at
 * the junction, the tail, the terminal. Rather than describing the change in
 * the abstract, it locates it on the letter.
 *
 * Method: sample both outlines, measure how far each sample sits from the
 * other shape, keep the samples that are genuinely far away, cluster them,
 * and name each cluster from where it falls on the letter and from what the
 * structural reading already found there.
 */
import type { Outline, Point, Rect } from '@/types/geometry'
import { contourSegments, outlineBounds } from '@/engine/geometry/outline'
import { flattenCubic, distance } from '@/engine/geometry/bezier'
import type { GlyphStructure } from './glyphStructure'

export interface DiffHotspot {
  /** Centre of the difference, in font units. */
  x: number
  y: number
  /** Radius that covers the cluster, in font units. */
  radius: number
  label: string
  /** How far apart the two shapes are here, in font units. */
  magnitude: number
}

/** Dense point cloud along an outline. */
function samplePoints(outline: Outline, step: number): Point[] {
  const points: Point[] = []
  for (const contour of outline.contours) {
    for (const segment of contourSegments(contour)) {
      if (segment.kind === 'line') {
        const length = distance(segment.from, segment.to)
        const count = Math.max(1, Math.ceil(length / step))
        for (let i = 0; i < count; i += 1) {
          const t = i / count
          points.push({
            x: segment.from.x + (segment.to.x - segment.from.x) * t,
            y: segment.from.y + (segment.to.y - segment.from.y) * t,
          })
        }
      } else {
        points.push(segment.from)
        points.push(
          ...flattenCubic(
            segment.from,
            segment.c1,
            segment.c2,
            segment.to,
            Math.max(0.5, step / 8),
          ),
        )
      }
    }
  }
  return points
}

/** Uniform grid so nearest-point queries stay linear rather than quadratic. */
class PointGrid {
  private readonly cells = new Map<string, Point[]>()
  private readonly cellSize: number

  constructor(points: readonly Point[], cellSize: number) {
    this.cellSize = cellSize
    for (const point of points) {
      const key = this.key(point.x, point.y)
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(point)
      else this.cells.set(key, [point])
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`
  }

  nearest(point: Point, maxRings = 6): number {
    const cx = Math.floor(point.x / this.cellSize)
    const cy = Math.floor(point.y / this.cellSize)
    let best = Infinity
    for (let ring = 0; ring <= maxRings; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          // Only the newly added shell each time round.
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue
          const bucket = this.cells.get(`${cx + dx},${cy + dy}`)
          if (!bucket) continue
          for (const candidate of bucket) {
            const d = distance(point, candidate)
            if (d < best) best = d
          }
        }
      }
      // Once a hit is closer than the ring we have searched, it is the answer.
      if (best <= ring * this.cellSize) return best
    }
    return best
  }
}

interface Sample {
  point: Point
  gap: number
}

/**
 * Names a region using the vocabulary a type designer would use for that
 * part of a letter.
 *
 * Anything the structural pass already located wins, because it was measured
 * on this letter rather than inferred from a grid.
 */
function nameZone(
  point: Point,
  bounds: Rect,
  structure: GlyphStructure | null,
): string {
  const width = Math.max(1, bounds.xMax - bounds.xMin)
  const height = Math.max(1, bounds.yMax - bounds.yMin)
  const rx = (point.x - bounds.xMin) / width
  const ry = (point.y - bounds.yMin) / height

  if (structure?.tail) {
    const tail = structure.tail.bounds
    if (
      point.x >= tail.xMin - width * 0.08 &&
      point.y <= tail.yMax + height * 0.12
    ) {
      return 'Tail'
    }
  }
  if (
    structure?.junction &&
    Math.abs(point.y - structure.junction.y) < height * 0.12
  ) {
    return 'Join'
  }

  if (ry > 0.72) return rx < 0.45 ? 'Arch' : 'Shoulder'
  if (ry < 0.24) return rx > 0.62 ? 'Terminal' : 'Foot'
  if (rx > 0.68) return 'Stem'
  if (rx < 0.32) return 'Bowl'
  return 'Aperture'
}

export interface DiffOptions {
  /** Ignore differences below this many font units. */
  threshold?: number
  /** Most hotspots to return. */
  limit?: number
  structure?: GlyphStructure | null
}

/**
 * Locates where outline `b` departs from outline `a`.
 *
 * Both directions are measured, because a shape that loses a stroke and a
 * shape that gains one are equally interesting and only one direction sees
 * each.
 */
export function diffHotspots(
  a: Outline,
  b: Outline,
  options: DiffOptions = {},
): DiffHotspot[] {
  if (a.contours.length === 0 || b.contours.length === 0) return []

  const bounds = outlineBounds(a)
  const size = Math.max(
    1,
    Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin),
  )
  const step = size / 90
  const threshold = options.threshold ?? size * 0.06
  const limit = options.limit ?? 3

  const pointsA = samplePoints(a, step)
  const pointsB = samplePoints(b, step)
  if (pointsA.length === 0 || pointsB.length === 0) return []

  const gridA = new PointGrid(pointsA, Math.max(step * 4, size / 24))
  const gridB = new PointGrid(pointsB, Math.max(step * 4, size / 24))

  const samples: Sample[] = []
  for (const point of pointsA) {
    const gap = gridB.nearest(point)
    if (gap > threshold) samples.push({ point, gap })
  }
  for (const point of pointsB) {
    const gap = gridA.nearest(point)
    if (gap > threshold) samples.push({ point, gap })
  }
  if (samples.length === 0) return []

  // Greedy clustering: strongest sample first, absorbing everything near it.
  samples.sort((x, y) => y.gap - x.gap)
  const radius = size * 0.18
  const used = new Array<boolean>(samples.length).fill(false)
  const hotspots: DiffHotspot[] = []

  for (let i = 0; i < samples.length && hotspots.length < limit; i += 1) {
    if (used[i]) continue
    const seed = samples[i]
    const members: Sample[] = [seed]
    used[i] = true

    for (let j = i + 1; j < samples.length; j += 1) {
      if (used[j]) continue
      if (distance(seed.point, samples[j].point) <= radius) {
        used[j] = true
        members.push(samples[j])
      }
    }

    const cx = members.reduce((sum, m) => sum + m.point.x, 0) / members.length
    const cy = members.reduce((sum, m) => sum + m.point.y, 0) / members.length
    const spread = Math.max(
      size * 0.05,
      ...members.map((m) => distance({ x: cx, y: cy }, m.point)),
    )

    hotspots.push({
      x: cx,
      y: cy,
      radius: Math.min(spread * 1.15, size * 0.3),
      label: nameZone({ x: cx, y: cy }, bounds, options.structure ?? null),
      magnitude: seed.gap,
    })
  }

  // Two hotspots that ended up with the same name are one thing described
  // twice; keep the stronger.
  const byLabel = new Map<string, DiffHotspot>()
  for (const hotspot of hotspots) {
    const existing = byLabel.get(hotspot.label)
    if (!existing || hotspot.magnitude > existing.magnitude) {
      byLabel.set(hotspot.label, hotspot)
    }
  }

  return [...byLabel.values()].sort((x, y) => y.magnitude - x.magnitude)
}
