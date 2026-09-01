/**
 * Applying a change to part of a glyph instead of all of it.
 *
 * Most edits a designer wants are local: thicken the stem but not the bowl,
 * take the ear from that other 'g' and leave the rest, slant the descender
 * only. Applying every change to the whole letter is what makes an editor
 * feel blunt.
 *
 * A scope names which part. The transform engine already works on subsets
 * of nodes and contours, so restricting a change is a matter of resolving a
 * scope to a node set and handing that to the machinery that already
 * exists — not of a second, parallel implementation.
 */
import type { Outline, Rect } from '@/types/geometry'
import { outlineBounds } from '@/engine/geometry/outline'

export const SCOPE_KIND = {
  /** Everything. */
  Whole: 'whole',
  /** The nodes currently selected in the editor. */
  Selection: 'selection',
  /** Whole contours, chosen by id. */
  Contours: 'contours',
  /** Everything inside a rectangle drawn on the canvas. */
  Region: 'region',
  /** A horizontal band, e.g. "below the baseline" or "above the x-height". */
  Band: 'band',
} as const
export type ScopeKind = (typeof SCOPE_KIND)[keyof typeof SCOPE_KIND]

export type EditScope =
  | { kind: 'whole' }
  | { kind: 'selection'; nodeIds: readonly string[] }
  | { kind: 'contours'; contourIds: readonly string[] }
  | { kind: 'region'; rect: Rect }
  | { kind: 'band'; from: number; to: number }

export const WHOLE_GLYPH: EditScope = { kind: 'whole' }

export interface ResolvedScope {
  /** Node ids the change should touch. */
  nodeIds: string[]
  /** True when that is every node in the glyph. */
  isWhole: boolean
  /** Bounds of the affected nodes, for previewing and for transform origins. */
  bounds: Rect | null
}

function allNodeIds(outline: Outline): string[] {
  return outline.contours.flatMap((contour) =>
    contour.nodes.map((node) => node.id),
  )
}

function boundsOfNodes(outline: Outline, ids: ReadonlySet<string>): Rect | null {
  let rect: Rect | null = null
  for (const contour of outline.contours) {
    for (const node of contour.nodes) {
      if (!ids.has(node.id)) continue
      rect = rect
        ? {
            xMin: Math.min(rect.xMin, node.x),
            yMin: Math.min(rect.yMin, node.y),
            xMax: Math.max(rect.xMax, node.x),
            yMax: Math.max(rect.yMax, node.y),
          }
        : { xMin: node.x, yMin: node.y, xMax: node.x, yMax: node.y }
    }
  }
  return rect
}

/**
 * Turns a scope into the set of nodes it names.
 *
 * A region or band takes a node when its *anchor* falls inside. Handles
 * travel with their anchor, so a curve never gets torn in half by a
 * boundary that happens to cross it.
 */
export function resolveScope(
  outline: Outline,
  scope: EditScope,
): ResolvedScope {
  if (scope.kind === 'whole') {
    const nodeIds = allNodeIds(outline)
    return {
      nodeIds,
      isWhole: true,
      bounds: nodeIds.length > 0 ? outlineBounds(outline) : null,
    }
  }

  let ids: string[]

  switch (scope.kind) {
    case 'selection':
      ids = [...scope.nodeIds]
      break

    case 'contours': {
      const wanted = new Set(scope.contourIds)
      ids = outline.contours
        .filter((contour) => wanted.has(contour.id))
        .flatMap((contour) => contour.nodes.map((node) => node.id))
      break
    }

    case 'region':
      ids = outline.contours.flatMap((contour) =>
        contour.nodes
          .filter(
            (node) =>
              node.x >= scope.rect.xMin &&
              node.x <= scope.rect.xMax &&
              node.y >= scope.rect.yMin &&
              node.y <= scope.rect.yMax,
          )
          .map((node) => node.id),
      )
      break

    case 'band': {
      const low = Math.min(scope.from, scope.to)
      const high = Math.max(scope.from, scope.to)
      ids = outline.contours.flatMap((contour) =>
        contour.nodes
          .filter((node) => node.y >= low && node.y <= high)
          .map((node) => node.id),
      )
      break
    }
  }

  const set = new Set(ids)
  const total = allNodeIds(outline).length
  return {
    nodeIds: [...set],
    isWhole: total > 0 && set.size === total,
    bounds: boundsOfNodes(outline, set),
  }
}

/** Bands worth offering by name, derived from the font's own metrics. */
export interface BandPreset {
  id: string
  label: string
  from: number
  to: number
}

export function metricBands(metrics: {
  unitsPerEm: number
  ascender: number
  descender: number
  xHeight: number | null
  capHeight: number | null
}): BandPreset[] {
  const xHeight = metrics.xHeight ?? metrics.unitsPerEm * 0.5
  const capHeight = metrics.capHeight ?? metrics.unitsPerEm * 0.7
  const bands: BandPreset[] = [
    {
      id: 'below-baseline',
      label: 'Below the baseline',
      from: metrics.descender,
      to: 0,
    },
    { id: 'x-height-band', label: 'Baseline to x-height', from: 0, to: xHeight },
    {
      id: 'above-x-height',
      label: 'Above the x-height',
      from: xHeight,
      to: metrics.ascender,
    },
    { id: 'cap-band', label: 'Baseline to cap height', from: 0, to: capHeight },
  ]
  return bands.filter((band) => band.to > band.from)
}

export function describeScope(scope: EditScope, resolved: ResolvedScope): string {
  if (scope.kind === 'whole') return 'the whole glyph'
  if (resolved.nodeIds.length === 0) return 'nothing — no anchors are in scope'
  const count = `${resolved.nodeIds.length} anchor${resolved.nodeIds.length === 1 ? '' : 's'}`
  switch (scope.kind) {
    case 'selection':
      return `${count} selected`
    case 'contours':
      return `${count} in ${scope.contourIds.length} contour${scope.contourIds.length === 1 ? '' : 's'}`
    case 'region':
      return `${count} inside the region`
    case 'band':
      return `${count} between ${Math.round(scope.from)} and ${Math.round(scope.to)}`
  }
}
