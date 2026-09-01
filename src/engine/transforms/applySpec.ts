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
import { resolveScope, WHOLE_GLYPH, type EditScope } from './scope'
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

/**
 * Transformations that move existing anchors without adding or removing
 * any. Only these can be limited to part of a glyph at anchor level: the
 * result is merged back node by node, which needs the node set to match.
 *
 * Offsetting and corner rounding deliberately change how many nodes there
 * are, so they can only be scoped to whole contours.
 */
const NODE_PRESERVING = new Set([
  'scale',
  'move',
  'rotate',
  'slant',
  'flip',
])

export function isNodePreserving(spec: TransformSpec): boolean {
  return NODE_PRESERVING.has(spec.kind)
}

/**
 * Merges a transformed outline back into the original, keeping the new
 * geometry only for the anchors in scope.
 *
 * Both outlines came from the same glyph and the transform preserved node
 * identity, so the merge is by id rather than by position.
 */
function mergeScoped(
  original: Outline,
  transformed: Outline,
  inScope: ReadonlySet<string>,
): Outline {
  const replacements = new Map<string, (typeof transformed.contours)[number]['nodes'][number]>()
  for (const contour of transformed.contours) {
    for (const node of contour.nodes) replacements.set(node.id, node)
  }

  return {
    contours: original.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => {
        if (!inScope.has(node.id)) return node
        return replacements.get(node.id) ?? node
      }),
    })),
  }
}

export function applyTransformSpec(
  glyphs: readonly ResolvedGlyph[],
  spec: TransformSpec,
  scope: EditScope = WHOLE_GLYPH,
): Record<number, GlyphEdit> {
  if (glyphs.length === 0) return {}

  if (scope.kind !== 'whole') {
    const result: Record<number, GlyphEdit> = {}
    for (const glyph of glyphs) {
      result[glyph.index] = applyScoped(glyph, spec, scope)
    }
    return result
  }

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

/**
 * Applies a transformation to part of a glyph.
 *
 * The whole-glyph result is computed first and then merged back for the
 * anchors in scope. Doing it this way means a scoped change goes through
 * exactly the same maths as an unscoped one, rather than through a second
 * implementation that could drift from it.
 *
 * The advance width is left alone: changing the spacing of a letter because
 * part of it moved is almost never what was meant.
 */
function applyScoped(
  glyph: ResolvedGlyph,
  spec: TransformSpec,
  scope: EditScope,
): GlyphEdit {
  const resolved = resolveScope(glyph.outline, scope)
  if (resolved.nodeIds.length === 0) {
    return { outline: glyph.outline, advanceWidth: glyph.advanceWidth }
  }
  if (resolved.isWhole) return applyToGlyph(glyph, spec)

  const inScope = new Set(resolved.nodeIds)

  if (isNodePreserving(spec)) {
    // Origins are taken from the part being changed rather than the whole
    // letter: scaling a stem about the glyph's centre would slide it
    // sideways instead of thickening it in place.
    const whole = applyToGlyph(
      { ...glyph, bounds: resolved.bounds ?? glyph.bounds },
      spec,
    )
    const outline = whole.outline ?? glyph.outline
    return {
      outline: mergeScoped(glyph.outline, outline, inScope),
      advanceWidth: glyph.advanceWidth,
    }
  }

  // Structure-changing: restrict to contours lying wholly in scope, so the
  // operation still sees a complete closed path to work on.
  const affected = new Set(
    glyph.outline.contours
      .filter((contour) => contour.nodes.every((node) => inScope.has(node.id)))
      .map((contour) => contour.id),
  )
  if (affected.size === 0) {
    return { outline: glyph.outline, advanceWidth: glyph.advanceWidth }
  }

  const parts = glyph.outline.contours.filter((c) => affected.has(c.id))
  const rest = glyph.outline.contours.filter((c) => !affected.has(c.id))
  const changed = applyToGlyph(
    { ...glyph, outline: { contours: parts } },
    spec,
  )

  return {
    outline: { contours: [...rest, ...(changed.outline?.contours ?? parts)] },
    advanceWidth: glyph.advanceWidth,
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
