/**
 * Whole-glyph transformations.
 *
 * These operate on the resolved glyph and return a GlyphEdit, so they are
 * reversible (history stores the previous edit) and composable with the
 * multi-glyph and preview machinery.
 */
import type { GlyphEdit, ResolvedGlyph } from '@/types/font'
import type { Matrix, Point, Rect } from '@/types/geometry'
import {
  about,
  compose,
  rotation,
  scaling,
  skewX,
  transformOutline,
  translation,
} from '@/engine/geometry/transform'
import { outlineBounds } from '@/engine/geometry/outline'

/**
 * The point a scale or rotation is performed about.
 *
 * Two of these are typographic and the rest are geometric. `baseline` is the
 * font origin -- x = 0 on the baseline -- which is the only origin that
 * keeps a letter registered with the rest of the alphabet, and
 * `center-baseline` is the usual choice for making a letter wider without
 * lifting it off the line. The nine-point grid is the reference-point widget
 * every vector editor offers, anchored on the glyph's ink rather than on the
 * em square, and it is what you want when the shape is being manipulated as
 * a shape.
 */
export const ORIGIN_MODE = {
  /** The font origin: x = 0 on the baseline. */
  Baseline: 'baseline',
  /** Centre of the glyph's ink. */
  Center: 'center',
  /** Centre horizontally, baseline vertically -- the usual choice. */
  CenterBaseline: 'center-baseline',

  TopLeft: 'top-left',
  TopCenter: 'top-center',
  TopRight: 'top-right',
  MiddleLeft: 'middle-left',
  MiddleRight: 'middle-right',
  BottomLeft: 'bottom-left',
  BottomCenter: 'bottom-center',
  BottomRight: 'bottom-right',
} as const
export type OriginMode = (typeof ORIGIN_MODE)[keyof typeof ORIGIN_MODE]

export function resolveOrigin(bounds: Rect, mode: OriginMode): Point {
  const left = bounds.xMin
  const right = bounds.xMax
  const middleX = (bounds.xMin + bounds.xMax) / 2
  const bottom = bounds.yMin
  const top = bounds.yMax
  const middleY = (bounds.yMin + bounds.yMax) / 2

  switch (mode) {
    case ORIGIN_MODE.Center:
      return { x: middleX, y: middleY }
    case ORIGIN_MODE.CenterBaseline:
      return { x: middleX, y: 0 }

    case ORIGIN_MODE.TopLeft:
      return { x: left, y: top }
    case ORIGIN_MODE.TopCenter:
      return { x: middleX, y: top }
    case ORIGIN_MODE.TopRight:
      return { x: right, y: top }
    case ORIGIN_MODE.MiddleLeft:
      return { x: left, y: middleY }
    case ORIGIN_MODE.MiddleRight:
      return { x: right, y: middleY }
    case ORIGIN_MODE.BottomLeft:
      return { x: left, y: bottom }
    case ORIGIN_MODE.BottomCenter:
      return { x: middleX, y: bottom }
    case ORIGIN_MODE.BottomRight:
      return { x: right, y: bottom }

    default:
      return { x: 0, y: 0 }
  }
}

export interface TransformOptions {
  origin?: OriginMode
  /** Scale the advance width along with the geometry. */
  scaleAdvance?: boolean
}

function applyMatrix(
  glyph: ResolvedGlyph,
  matrix: Matrix,
  advanceWidth: number,
): GlyphEdit {
  return {
    outline: transformOutline(glyph.outline, matrix),
    advanceWidth: Math.max(0, Math.round(advanceWidth)),
  }
}

/**
 * Scales a glyph. When the advance is scaled too, side bearings scale with
 * the shape, which is what "make this 5% wider" means for a whole font.
 */
export function scaleGlyph(
  glyph: ResolvedGlyph,
  sx: number,
  sy: number,
  options: TransformOptions = {},
): GlyphEdit {
  const origin = resolveOrigin(
    glyph.bounds,
    options.origin ?? ORIGIN_MODE.Baseline,
  )
  const matrix = about(scaling(sx, sy), origin)
  const advance = options.scaleAdvance === false
    ? glyph.advanceWidth
    : glyph.advanceWidth * sx
  return applyMatrix(glyph, matrix, advance)
}

export function rotateGlyph(
  glyph: ResolvedGlyph,
  degrees: number,
  options: TransformOptions = {},
): GlyphEdit {
  const origin = resolveOrigin(
    glyph.bounds,
    options.origin ?? ORIGIN_MODE.CenterBaseline,
  )
  return applyMatrix(glyph, about(rotation(degrees), origin), glyph.advanceWidth)
}

/**
 * Shears a glyph horizontally about the baseline, the standard way to
 * produce an oblique. Positive angles lean the top to the right.
 */
export function slantGlyph(
  glyph: ResolvedGlyph,
  degrees: number,
  options: { pivotY?: number; adjustAdvance?: boolean } = {},
): GlyphEdit {
  const pivotY = options.pivotY ?? 0
  const matrix = about(skewX(degrees), { x: 0, y: pivotY })
  // Shearing about the baseline does not change the advance width; the
  // glyph simply leans within it.
  return applyMatrix(glyph, matrix, glyph.advanceWidth)
}

export function flipGlyph(
  glyph: ResolvedGlyph,
  axis: 'horizontal' | 'vertical',
  options: TransformOptions = {},
): GlyphEdit {
  const origin = resolveOrigin(
    glyph.bounds,
    options.origin ?? ORIGIN_MODE.CenterBaseline,
  )
  const matrix =
    axis === 'horizontal'
      ? about(scaling(-1, 1), origin)
      : about(scaling(1, -1), origin)
  return applyMatrix(glyph, matrix, glyph.advanceWidth)
}

export function moveGlyph(
  glyph: ResolvedGlyph,
  dx: number,
  dy: number,
): GlyphEdit {
  return applyMatrix(glyph, translation(dx, dy), glyph.advanceWidth)
}

/**
 * Scales the glyph vertically about the baseline while keeping the advance
 * width. Used by "Height +5%".
 */
export function scaleHeight(glyph: ResolvedGlyph, factor: number): GlyphEdit {
  return scaleGlyph(glyph, 1, factor, {
    origin: ORIGIN_MODE.Baseline,
    scaleAdvance: false,
  })
}

/** Scales the glyph horizontally, advance included. Used by "Width +5%". */
export function scaleWidth(glyph: ResolvedGlyph, factor: number): GlyphEdit {
  return scaleGlyph(glyph, factor, 1, {
    origin: ORIGIN_MODE.Baseline,
    scaleAdvance: true,
  })
}

export const ALIGNMENT = {
  Left: 'left',
  CenterX: 'center-x',
  Right: 'right',
  Top: 'top',
  CenterY: 'center-y',
  Bottom: 'bottom',
  Baseline: 'baseline',
} as const
export type Alignment = (typeof ALIGNMENT)[keyof typeof ALIGNMENT]

/**
 * Aligns a glyph's ink inside its own advance width, or to a shared
 * reference when several glyphs are aligned together.
 */
export function alignGlyph(
  glyph: ResolvedGlyph,
  alignment: Alignment,
  reference: Rect,
): GlyphEdit {
  if (glyph.isEmpty) {
    return { outline: glyph.outline, advanceWidth: glyph.advanceWidth }
  }
  const b = glyph.bounds
  let dx = 0
  let dy = 0
  switch (alignment) {
    case ALIGNMENT.Left:
      dx = reference.xMin - b.xMin
      break
    case ALIGNMENT.Right:
      dx = reference.xMax - b.xMax
      break
    case ALIGNMENT.CenterX:
      dx = (reference.xMin + reference.xMax) / 2 - (b.xMin + b.xMax) / 2
      break
    case ALIGNMENT.Top:
      dy = reference.yMax - b.yMax
      break
    case ALIGNMENT.Bottom:
      dy = reference.yMin - b.yMin
      break
    case ALIGNMENT.CenterY:
      dy = (reference.yMin + reference.yMax) / 2 - (b.yMin + b.yMax) / 2
      break
    case ALIGNMENT.Baseline:
      dy = -b.yMin
      break
  }
  return moveGlyph(glyph, dx, dy)
}

/** Bounding box covering several glyphs, for group alignment. */
export function unionBounds(glyphs: readonly ResolvedGlyph[]): Rect {
  const solid = glyphs.filter((g) => !g.isEmpty)
  if (solid.length === 0) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  return solid.reduce<Rect>(
    (acc, glyph) => ({
      xMin: Math.min(acc.xMin, glyph.bounds.xMin),
      yMin: Math.min(acc.yMin, glyph.bounds.yMin),
      xMax: Math.max(acc.xMax, glyph.bounds.xMax),
      yMax: Math.max(acc.yMax, glyph.bounds.yMax),
    }),
    solid[0].bounds,
  )
}

/**
 * Distributes glyph advance widths evenly between the narrowest and widest
 * in the selection, keeping the ink centred in each new advance.
 */
export function distributeWidths(
  glyphs: readonly ResolvedGlyph[],
): Record<number, GlyphEdit> {
  if (glyphs.length < 3) return {}
  const sorted = [...glyphs].sort((a, b) => a.advanceWidth - b.advanceWidth)
  const min = sorted[0].advanceWidth
  const max = sorted[sorted.length - 1].advanceWidth
  const step = (max - min) / (sorted.length - 1)

  const result: Record<number, GlyphEdit> = {}
  sorted.forEach((glyph, index) => {
    const target = Math.round(min + step * index)
    const delta = (target - glyph.advanceWidth) / 2
    result[glyph.index] = {
      outline: glyph.isEmpty
        ? glyph.outline
        : transformOutline(glyph.outline, translation(delta, 0)),
      advanceWidth: target,
    }
  })
  return result
}

/** Composes several matrices into one edit, avoiding intermediate rounding. */
export function transformGlyph(
  glyph: ResolvedGlyph,
  matrices: Matrix[],
  advanceWidth = glyph.advanceWidth,
): GlyphEdit {
  return applyMatrix(glyph, compose(...matrices), advanceWidth)
}

export function boundsAfter(glyph: ResolvedGlyph, edit: GlyphEdit): Rect {
  return outlineBounds(edit.outline ?? glyph.outline)
}
