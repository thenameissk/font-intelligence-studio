/**
 * Placing a traced shape into the font's own frame.
 *
 * A trace arrives in pixels, upside down relative to type coordinates, at
 * whatever size the photograph happened to be. Dropping it into a glyph slot
 * unchanged would produce something the size of a house sitting below the
 * baseline. This maps it onto the metrics the font already uses -- its
 * baseline, its x-height or cap height, its advance width and side bearings
 * -- so the traced letter sits in the font rather than merely near it.
 *
 * The advance width is never taken from the image. The image supplies shape;
 * the font keeps its own rhythm.
 */
import type { OutlineFormat, VerticalMetrics } from '@/types/font'
import type { Outline, Rect } from '@/types/geometry'
import { contourIsOuter } from '@/engine/geometry/nesting'
import {
  contourSignedArea,
  outlineBounds,
  reverseContour,
} from '@/engine/geometry/outline'
import { scaling, transformOutline, translation, multiply } from '@/engine/geometry/transform'

export const VERTICAL_FIT = {
  /** Match the height of the glyph being replaced. */
  GlyphBounds: 'glyph-bounds',
  XHeight: 'x-height',
  CapHeight: 'cap-height',
} as const
export type VerticalFit = (typeof VERTICAL_FIT)[keyof typeof VERTICAL_FIT]

export const HORIZONTAL_FIT = {
  /** Keep the traced proportions and use the glyph's left bearing. */
  KeepAspect: 'keep-aspect',
  /** Stretch to occupy the same ink width as the glyph being replaced. */
  MatchWidth: 'match-width',
  /** Keep proportions but centre within the advance. */
  Centre: 'centre',
} as const
export type HorizontalFit =
  (typeof HORIZONTAL_FIT)[keyof typeof HORIZONTAL_FIT]

export interface FitTarget {
  bounds: Rect
  advanceWidth: number
  isEmpty: boolean
}

export const SOURCE_SPACE = {
  /** y runs downwards, as it does in an image. */
  Image: 'image',
  /** y runs upwards, as it does in a font. */
  Font: 'font',
} as const
export type SourceSpace = (typeof SOURCE_SPACE)[keyof typeof SOURCE_SPACE]

export interface FitOptions {
  metrics: VerticalMetrics
  target: FitTarget
  outlineFormat: OutlineFormat
  vertical?: VerticalFit
  horizontal?: HorizontalFit
  /**
   * Which way up the source is. A trace arrives from image space and has to
   * be flipped; a glyph borrowed from another font is already upright, and
   * flipping it would place it under the baseline upside down.
   */
  sourceSpace?: SourceSpace
}

export interface FitResult {
  outline: Outline
  /** Always the font's own advance; the image never sets spacing. */
  advanceWidth: number
  notes: string[]
}

/**
 * Sets contour directions to the convention the font's outline format uses:
 * TrueType fills with clockwise outer contours, PostScript with
 * counter-clockwise. Getting this wrong renders the glyph inside out.
 */
export function normalizeWinding(
  outline: Outline,
  outlineFormat: OutlineFormat,
): Outline {
  const outer = contourIsOuter(outline)
  const outerShouldBeClockwise = outlineFormat === 'truetype'

  return {
    contours: outline.contours.map((contour, index) => {
      const area = contourSignedArea(contour)
      if (Math.abs(area) < 1e-9) return contour
      const isClockwise = area < 0
      const shouldBeClockwise = outer[index] === outerShouldBeClockwise
      return isClockwise === shouldBeClockwise ? contour : reverseContour(contour)
    }),
  }
}

export function fitOutlineToMetrics(
  traced: Outline,
  options: FitOptions,
): FitResult {
  const notes: string[] = []
  if (traced.contours.length === 0) {
    return { outline: traced, advanceWidth: options.target.advanceWidth, notes }
  }

  const vertical = options.vertical ?? VERTICAL_FIT.GlyphBounds
  const horizontal = options.horizontal ?? HORIZONTAL_FIT.KeepAspect
  const { metrics, target } = options

  const flipped =
    (options.sourceSpace ?? SOURCE_SPACE.Image) === SOURCE_SPACE.Image
      ? transformOutline(traced, scaling(1, -1))
      : traced
  const source = outlineBounds(flipped)
  const sourceHeight = source.yMax - source.yMin
  const sourceWidth = source.xMax - source.xMin
  if (sourceHeight <= 0 || sourceWidth <= 0) {
    return { outline: traced, advanceWidth: target.advanceWidth, notes }
  }

  // How tall should it be, and where does its foot sit?
  let targetHeight: number
  let baseline: number
  const usableTarget = !target.isEmpty && target.bounds.yMax > target.bounds.yMin

  if (vertical === VERTICAL_FIT.GlyphBounds && usableTarget) {
    targetHeight = target.bounds.yMax - target.bounds.yMin
    baseline = target.bounds.yMin
    notes.push('Scaled to the height of the glyph it replaces.')
  } else if (vertical === VERTICAL_FIT.CapHeight) {
    targetHeight = metrics.capHeight ?? metrics.ascender * 0.7
    baseline = 0
    notes.push('Scaled to the font’s cap height.')
  } else {
    targetHeight = metrics.xHeight ?? metrics.unitsPerEm * 0.52
    baseline = 0
    notes.push('Scaled to the font’s x-height.')
  }

  const scaleY = targetHeight / sourceHeight
  let scaleX = scaleY

  if (horizontal === HORIZONTAL_FIT.MatchWidth && usableTarget) {
    const targetWidth = target.bounds.xMax - target.bounds.xMin
    if (targetWidth > 0) {
      scaleX = targetWidth / sourceWidth
      const distortion = Math.abs(scaleX / scaleY - 1)
      notes.push(
        distortion > 0.02
          ? `Stretched horizontally by ${Math.round(distortion * 100)}% to match the glyph’s ink width.`
          : 'Matched to the glyph’s ink width.',
      )
    }
  } else {
    notes.push('Proportions preserved.')
  }

  const scaled = transformOutline(
    flipped,
    multiply(
      translation(-source.xMin, -source.yMin),
      scaling(scaleX, scaleY),
    ),
  )

  // Where does it sit horizontally? The font's own bearings decide.
  const scaledBounds = outlineBounds(scaled)
  const inkWidth = scaledBounds.xMax - scaledBounds.xMin
  let left: number

  if (horizontal === HORIZONTAL_FIT.Centre) {
    left = (target.advanceWidth - inkWidth) / 2
    notes.push('Centred within the font’s advance width.')
  } else if (usableTarget) {
    left = target.bounds.xMin
    notes.push(
      `Left bearing kept at ${Math.round(target.bounds.xMin)} units.`,
    )
  } else {
    left = (target.advanceWidth - inkWidth) / 2
    notes.push('Centred, since the glyph had no outline to take bearings from.')
  }

  const placed = transformOutline(
    scaled,
    translation(left - scaledBounds.xMin, baseline - scaledBounds.yMin),
  )

  const wound = normalizeWinding(placed, options.outlineFormat)
  notes.push('Contour directions set for this font’s outline format.')

  return {
    outline: wound,
    advanceWidth: target.advanceWidth,
    notes,
  }
}
