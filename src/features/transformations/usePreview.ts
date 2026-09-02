import { useMemo } from 'react'
import type { ResolvedGlyph } from '@/types/font'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { applyTransformSpec } from '@/engine/transforms/applySpec'
import { outlineBounds } from '@/engine/geometry/outline'
import { useFontStore } from '@/store/fontStore'
import { useTransformStore } from '@/store/transformStore'

/**
 * Resolves glyphs with the pending transformation applied on top.
 *
 * The preview never touches the document, so cancelling costs nothing and
 * the undo history stays free of half-finished experiments.
 */
export function usePreviewedGlyphs(
  parsed: ParsedFont | null,
  indices: readonly number[],
): ResolvedGlyph[] {
  const edits = useFontStore((s) => s.edits)
  const spec = useTransformStore((s) => s.spec)
  const scope = useTransformStore((s) => s.scope)
  const targets = useTransformStore((s) => s.targets)

  return useMemo(() => {
    if (!parsed) return []
    const base = indices.map((index) => resolveGlyph(parsed, edits, index))
    if (!spec || targets.length === 0) return base

    const targetSet = new Set(targets)
    const affected = base.filter((glyph) => targetSet.has(glyph.index))
    if (affected.length === 0) return base

    const preview = applyTransformSpec(affected, spec, scope)
    return base.map((glyph) => {
      const edit = preview[glyph.index]
      if (!edit) return glyph
      const outline = edit.outline ?? glyph.outline
      const advanceWidth = edit.advanceWidth ?? glyph.advanceWidth
      const bounds = outlineBounds(outline)
      return {
        ...glyph,
        outline,
        advanceWidth,
        bounds,
        leftSideBearing: bounds.xMin,
        rightSideBearing: advanceWidth - bounds.xMax,
        isEmpty: outline.contours.length === 0,
      }
    })
    // `scope` is a dependency: a preview computed for the whole glyph
    // must not linger once the change has been narrowed to part of it.
  }, [parsed, indices, edits, spec, targets, scope])
}

/**
 * The same glyphs without the pending transformation.
 *
 * Anything that *applies* the pending spec must start from these. Applying
 * it to the previewed glyphs instead transforms an already-transformed
 * shape, so asking for half height produced a quarter.
 */
export function useBaseGlyphs(
  parsed: ParsedFont | null,
  indices: readonly number[],
): ResolvedGlyph[] {
  const edits = useFontStore((s) => s.edits)
  return useMemo(
    () =>
      parsed === null
        ? []
        : indices.map((index) => resolveGlyph(parsed, edits, index)),
    [parsed, indices, edits],
  )
}

export function usePreviewedGlyph(
  parsed: ParsedFont | null,
  index: number | null,
): ResolvedGlyph | null {
  const indices = useMemo(() => (index === null ? [] : [index]), [index])
  const glyphs = usePreviewedGlyphs(parsed, indices)
  return glyphs[0] ?? null
}
