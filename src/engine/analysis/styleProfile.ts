/**
 * A style reading that any outline can produce, whether it came from a font
 * or from a traced photograph.
 *
 * Because both sides are measured the same way, the difference between them
 * is meaningful: it says how much heavier, how much more slanted, how much
 * wider one shape is than the other, in units that a transformation can act
 * on. That is what makes matching a reference a calculation rather than a
 * guess.
 *
 * Every value is normalised by the shape's own height, so a 2000-pixel photo
 * and a 1000-unit em compare directly.
 */
import type { Outline } from '@/types/geometry'
import { outlineBounds } from '@/engine/geometry/outline'
import { inkArea } from '@/engine/geometry/intersect'
import {
  measureCorners,
  measureCurvature,
  measureHorizontalStroke,
  measureSlant,
  measureVerticalStem,
} from './measure'

export interface StyleProfile {
  /** Ink height in the outline's own units. */
  height: number
  /** Ink width divided by ink height. */
  widthRatio: number
  /** Vertical stem thickness as a fraction of height. */
  stemRatio: number | null
  /** Horizontal stroke thickness as a fraction of height. */
  strokeRatio: number | null
  /** 0 for a monoline, approaching 1 as thick and thin diverge. */
  contrast: number | null
  /** Degrees; positive leans right. */
  slant: number | null
  /** Share of the bounding box that is ink -- a proxy for colour. */
  density: number
  /** 0 fully rounded, 1 all sharp corners. */
  cornerSharpness: number | null
  /**
   * How many corner nodes the reading came from.
   *
   * Corner sharpness is a share, and a share of two nodes says nothing. A
   * traced outline and a drawn one place nodes quite differently, so the
   * count travels with the value and callers refuse to act on a thin one.
   */
  cornerSamples: number
  /** Mean absolute curvature, normalised. */
  curviness: number | null
}

const EMPTY: StyleProfile = {
  height: 0,
  widthRatio: 0,
  stemRatio: null,
  strokeRatio: null,
  contrast: null,
  slant: null,
  density: 0,
  cornerSharpness: null,
  cornerSamples: 0,
  curviness: null,
}

export function profileOutline(outline: Outline): StyleProfile {
  if (outline.contours.length === 0) return EMPTY

  const bounds = outlineBounds(outline)
  const height = bounds.yMax - bounds.yMin
  const width = bounds.xMax - bounds.xMin
  if (height <= 0 || width <= 0) return EMPTY

  const stem = measureVerticalStem(outline)
  const stroke = measureHorizontalStroke(outline)
  const corners = measureCorners([outline])
  const curvature = measureCurvature([outline])

  const contrast =
    stem !== null && stroke !== null && Math.max(stem, stroke) > 0
      ? 1 - Math.min(stem, stroke) / Math.max(stem, stroke)
      : null

  return {
    height,
    widthRatio: width / height,
    stemRatio: stem !== null ? stem / height : null,
    strokeRatio: stroke !== null ? stroke / height : null,
    contrast,
    slant: measureSlant(outline),
    density: inkArea(outline) / (width * height),
    cornerSharpness: corners.cornerNodes > 0 ? corners.sharpFraction : null,
    cornerSamples: corners.cornerNodes,
    // Radius normalised by height, so a big photo and a small em compare.
    curviness:
      curvature.meanRadius !== null && curvature.meanRadius > 0
        ? height / curvature.meanRadius
        : null,
  }
}

export interface StyleAxis {
  id: string
  label: string
  /** Reading for the glyph being edited. */
  current: number | null
  /** Reading for the reference. */
  reference: number | null
  /** How the value is shown. */
  format: 'ratio' | 'percent' | 'degrees'
  /** True when the two readings are close enough to leave alone. */
  matched: boolean
}

function close(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance
}

/** Side-by-side readings, for the panel that explains what will change. */
export function compareProfiles(
  current: StyleProfile,
  reference: StyleProfile,
): StyleAxis[] {
  const axes: StyleAxis[] = []

  const push = (
    id: string,
    label: string,
    a: number | null,
    b: number | null,
    format: StyleAxis['format'],
    tolerance: number,
  ): void => {
    axes.push({
      id,
      label,
      current: a,
      reference: b,
      format,
      matched: a !== null && b !== null ? close(a, b, tolerance) : false,
    })
  }

  push('weight', 'Stem weight', current.stemRatio, reference.stemRatio, 'percent', 0.012)
  push('stroke', 'Horizontal stroke', current.strokeRatio, reference.strokeRatio, 'percent', 0.012)
  push('contrast', 'Contrast', current.contrast, reference.contrast, 'percent', 0.06)
  push('width', 'Width', current.widthRatio, reference.widthRatio, 'ratio', 0.04)
  push('slant', 'Slant', current.slant, reference.slant, 'degrees', 1.2)
  push('density', 'Ink density', current.density, reference.density, 'percent', 0.05)
  push('corners', 'Corner sharpness', current.cornerSharpness, reference.cornerSharpness, 'percent', 0.12)

  return axes
}

export function formatAxisValue(
  value: number | null,
  format: StyleAxis['format'],
): string {
  if (value === null || !Number.isFinite(value)) return '—'
  switch (format) {
    case 'percent':
      return `${(value * 100).toFixed(1)}%`
    case 'degrees':
      return `${value.toFixed(1)}°`
    default:
      return value.toFixed(2)
  }
}
