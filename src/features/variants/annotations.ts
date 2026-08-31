/**
 * Turning an analysis into the handful of callouts worth drawing.
 *
 * A diagram with six labels teaches nothing. These are ranked so the two or
 * three that actually characterise the letterform survive, and named after
 * the feature rather than its map reference: "Thinner", "Tail", "Counter" --
 * the words used when describing why one `a` differs from another.
 */
import type { Rect } from '@/types/geometry'
import type { GlyphStructure } from '@/engine/analysis/glyphStructure'
import type { DiffHotspot } from '@/engine/analysis/outlineDiff'
import type { VariantChange } from '@/engine/analysis/variants'

export interface Annotation {
  id: string
  /** Centre of the ring, in font units. */
  x: number
  y: number
  radius: number
  label: string
  /** Higher wins when there are too many to draw. */
  priority: number
}

export interface AnnotationInput {
  structure: GlyphStructure
  bounds: Rect
  unitsPerEm: number
  hotspots?: DiffHotspot[]
  changes?: VariantChange[]
  limit?: number
}

export function buildAnnotations(input: AnnotationInput): Annotation[] {
  const { structure, bounds, unitsPerEm } = input
  const limit = input.limit ?? 3
  const height = Math.max(1, bounds.yMax - bounds.yMin)
  const ring = Math.max(unitsPerEm * 0.055, height * 0.11)

  const annotations: Annotation[] = []

  // The narrowest join is the reading that matters most: it is where the
  // letter is most fragile, and the first thing a weight change breaks.
  if (structure.junction) {
    const changed = input.changes?.find((change) => change.id === 'junction')
    annotations.push({
      id: 'junction',
      x: structure.junction.x,
      y: structure.junction.y,
      radius: ring,
      label: changed ? changed.label : 'Thinner',
      priority: changed ? 100 : 70,
    })
  }

  if (structure.tail) {
    const changed = input.changes?.find(
      (change) => change.id === 'tail' || change.id === 'tail-reach',
    )
    annotations.push({
      id: 'tail',
      x: structure.tail.bounds.xMax - structure.tail.reach * 0.35,
      y: (structure.tail.bounds.yMin + structure.tail.bounds.yMax) / 2,
      radius: ring * 0.8,
      label: 'Tail',
      priority: changed ? 95 : 65,
    })
  }

  // A counter is worth naming when its presence is what tells the two forms
  // apart, which is precisely when the counter count changed.
  const counterChange = input.changes?.find((change) => change.id === 'counters')
  if (counterChange && structure.counters.length > 0) {
    const counter = structure.counters[0]
    annotations.push({
      id: 'counter',
      x: (counter.bounds.xMin + counter.bounds.xMax) / 2,
      y: (counter.bounds.yMin + counter.bounds.yMax) / 2,
      radius: ring,
      label: 'Counter',
      priority: 80,
    })
  }

  for (const [index, hotspot] of (input.hotspots ?? []).entries()) {
    // Skip anything already named by the structural pass.
    const duplicate = annotations.some(
      (existing) =>
        Math.hypot(existing.x - hotspot.x, existing.y - hotspot.y) <
        existing.radius * 1.6,
    )
    if (duplicate) continue
    annotations.push({
      id: `diff-${index}`,
      x: hotspot.x,
      y: hotspot.y,
      radius: Math.max(ring * 0.8, Math.min(hotspot.radius, ring * 1.8)),
      label: hotspot.label,
      priority: 40 - index,
    })
  }

  const byLabel = new Map<string, Annotation>()
  for (const annotation of annotations.sort((a, b) => b.priority - a.priority)) {
    if (!byLabel.has(annotation.label)) byLabel.set(annotation.label, annotation)
  }

  // Two callouts pointing at the same part of the letter say one thing
  // twice. Each survivor has to be somewhere new.
  const chosen: Annotation[] = []
  const minSeparation = ring * 1.9
  for (const annotation of byLabel.values()) {
    if (chosen.length >= limit) break
    const crowded = chosen.some(
      (existing) =>
        Math.hypot(existing.x - annotation.x, existing.y - annotation.y) <
        minSeparation,
    )
    if (!crowded) chosen.push(annotation)
  }

  return chosen
}

export interface PlacedLabel extends Annotation {
  /** Label anchor in screen space (y grows downwards). */
  labelX: number
  labelY: number
  anchor: 'start' | 'middle' | 'end'
  /** Leader line from the label back to the ring, when they are apart. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null
}

/**
 * Places labels above their rings, pushing them apart when they would
 * collide. Labels near the left edge swing right and vice versa, so a
 * callout never runs off the diagram.
 */
export function placeLabels(
  annotations: readonly Annotation[],
  options: { fontSize: number; bounds: Rect },
): PlacedLabel[] {
  const gap = options.fontSize * 0.55
  const placed: PlacedLabel[] = []

  // Top of the letter first, so pushing upwards never lands on a label
  // already positioned.
  const ordered = [...annotations].sort((a, b) => b.y - a.y)

  for (const annotation of ordered) {
    const ringTop = -annotation.y - annotation.radius
    let labelY = ringTop - gap

    // Nudge above anything already occupying this height nearby.
    for (const other of placed) {
      const overlapsHorizontally =
        Math.abs(other.labelX - annotation.x) < options.fontSize * 3.2
      if (overlapsHorizontally && Math.abs(other.labelY - labelY) < options.fontSize * 1.2) {
        labelY = other.labelY - options.fontSize * 1.25
      }
    }

    const nearLeft = annotation.x < options.bounds.xMin + options.fontSize * 2
    const anchor: PlacedLabel['anchor'] = nearLeft ? 'start' : 'middle'
    const labelX = nearLeft ? options.bounds.xMin : annotation.x

    const detached = Math.abs(labelY - ringTop) > gap * 1.6
    placed.push({
      ...annotation,
      labelX,
      labelY,
      anchor,
      leader: detached
        ? {
            x1: labelX,
            y1: labelY + options.fontSize * 0.28,
            x2: annotation.x,
            y2: ringTop,
          }
        : null,
    })
  }

  return placed
}
