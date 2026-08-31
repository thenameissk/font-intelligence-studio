/**
 * A declarative description of a transformation, plus the function that
 * turns it into per-glyph edits.
 *
 * Keeping transformations as data is what makes them previewable: the same
 * spec can be applied to produce a throwaway preview or committed to
 * history, and nothing is written until the user says so.
 */
import type { GlyphEdit, ResolvedGlyph } from '@/types/font'
import type { Outline } from '@/types/geometry'
import { offsetOutline } from './offset'
import { roundCorners } from './roundCorners'
import { applySpacingRule, type SpacingRule } from './spacing'
import {
  alignGlyph,
  distributeWidths,
  flipGlyph,
  moveGlyph,
  rotateGlyph,
  scaleGlyph,
  slantGlyph,
  unionBounds,
  type Alignment,
  type OriginMode,
} from './glyphTransforms'

export type TransformSpec =
  | {
      kind: 'scale'
      /** 1 = unchanged. */
      sx: number
      sy: number
      origin: OriginMode
      scaleAdvance: boolean
    }
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'rotate'; degrees: number; origin: OriginMode }
  | { kind: 'slant'; degrees: number }
  | { kind: 'flip'; axis: 'horizontal' | 'vertical' }
  | { kind: 'offset'; distance: number }
  | { kind: 'roundCorners'; radius: number; minAngle: number }
  | { kind: 'spacing'; rule: SpacingRule }
  | { kind: 'align'; alignment: Alignment; scope: 'own-advance' | 'selection' }
  | { kind: 'distributeWidths' }

export function describeSpec(spec: TransformSpec): string {
  switch (spec.kind) {
    case 'scale': {
      const parts: string[] = []
      if (spec.sx !== 1) parts.push(`width ${formatPercent(spec.sx)}`)
      if (spec.sy !== 1) parts.push(`height ${formatPercent(spec.sy)}`)
      return parts.length > 0 ? `Scale ${parts.join(', ')}` : 'Scale'
    }
    case 'move':
      return `Move ${spec.dx}, ${spec.dy}`
    case 'rotate':
      return `Rotate ${spec.degrees}°`
    case 'slant':
      return `Slant ${spec.degrees}°`
    case 'flip':
      return `Flip ${spec.axis}`
    case 'offset':
      return `${spec.distance >= 0 ? 'Thicken' : 'Thin'} ${Math.abs(spec.distance)} units`
    case 'roundCorners':
      return `Round corners ${spec.radius}`
    case 'spacing':
      return 'Normalise spacing'
    case 'align':
      return `Align ${spec.alignment}`
    case 'distributeWidths':
      return 'Distribute widths'
  }
}

function formatPercent(factor: number): string {
  const percent = (factor - 1) * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

function withOutline(glyph: ResolvedGlyph, outline: Outline): GlyphEdit {
  return { outline, advanceWidth: glyph.advanceWidth }
}

/**
 * True when the spec would leave every glyph untouched, so the UI can keep
 * Apply disabled rather than recording an empty command.
 */
export function specIsIdentity(spec: TransformSpec): boolean {
  switch (spec.kind) {
    case 'scale':
      return spec.sx === 1 && spec.sy === 1
    case 'move':
      return spec.dx === 0 && spec.dy === 0
    case 'rotate':
      return spec.degrees === 0
    case 'slant':
      return spec.degrees === 0
    case 'offset':
      return spec.distance === 0
    case 'roundCorners':
      return spec.radius <= 0
    default:
      return false
  }
}

export function applyTransformSpec(
  glyphs: readonly ResolvedGlyph[],
  spec: TransformSpec,
): Record<number, GlyphEdit> {
  if (glyphs.length === 0) return {}

  switch (spec.kind) {
    case 'spacing':
      return applySpacingRule(glyphs, spec.rule)

    case 'distributeWidths':
      return distributeWidths(glyphs)

    case 'align': {
      const reference =
        spec.scope === 'selection'
          ? unionBounds(glyphs)
          : null
      const result: Record<number, GlyphEdit> = {}
      for (const glyph of glyphs) {
        const target =
          reference ?? {
            xMin: 0,
            yMin: glyph.bounds.yMin,
            xMax: glyph.advanceWidth,
            yMax: glyph.bounds.yMax,
          }
        result[glyph.index] = alignGlyph(glyph, spec.alignment, target)
      }
      return result
    }

    default: {
      const result: Record<number, GlyphEdit> = {}
      for (const glyph of glyphs) {
        result[glyph.index] = applyToGlyph(glyph, spec)
      }
      return result
    }
  }
}

function applyToGlyph(glyph: ResolvedGlyph, spec: TransformSpec): GlyphEdit {
  switch (spec.kind) {
    case 'scale':
      return scaleGlyph(glyph, spec.sx, spec.sy, {
        origin: spec.origin,
        scaleAdvance: spec.scaleAdvance,
      })
    case 'move':
      return moveGlyph(glyph, spec.dx, spec.dy)
    case 'rotate':
      return rotateGlyph(glyph, spec.degrees, { origin: spec.origin })
    case 'slant':
      return slantGlyph(glyph, spec.degrees)
    case 'flip':
      return flipGlyph(glyph, spec.axis)
    case 'offset':
      return withOutline(glyph, offsetOutline(glyph.outline, spec.distance))
    case 'roundCorners':
      return withOutline(
        glyph,
        roundCorners(glyph.outline, {
          radius: spec.radius,
          minAngle: spec.minAngle,
        }),
      )
    default:
      return { outline: glyph.outline, advanceWidth: glyph.advanceWidth }
  }
}
