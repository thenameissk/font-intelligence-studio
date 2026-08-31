/**
 * Side-bearing normalisation.
 *
 * Spacing rules operate on a set of glyphs at once and return one edit per
 * glyph, so they slot straight into the multi-glyph preview and a single
 * undo step.
 */
import type { GlyphEdit, ResolvedGlyph } from '@/types/font'
import { setSideBearings } from './metrics'

export const SPACING_MODE = {
  /** Give every glyph the same bearings. */
  Fixed: 'fixed',
  /** Multiply existing bearings by a factor. */
  Scale: 'scale',
  /** Raise any bearing below the floor, leaving wider ones alone. */
  Minimum: 'minimum',
  /** Move every bearing towards the selection's average. */
  Average: 'average',
} as const
export type SpacingMode = (typeof SPACING_MODE)[keyof typeof SPACING_MODE]

export interface SpacingRule {
  mode: SpacingMode
  left?: number
  right?: number
  factor?: number
  /** 0 = leave alone, 1 = fully normalise. Used by the Average mode. */
  strength?: number
}

function bearingsOf(glyph: ResolvedGlyph): { left: number; right: number } {
  return {
    left: glyph.bounds.xMin,
    right: glyph.advanceWidth - glyph.bounds.xMax,
  }
}

export function applySpacingRule(
  glyphs: readonly ResolvedGlyph[],
  rule: SpacingRule,
): Record<number, GlyphEdit> {
  const targets = glyphs.filter((glyph) => !glyph.isEmpty)
  if (targets.length === 0) return {}

  const result: Record<number, GlyphEdit> = {}

  if (rule.mode === SPACING_MODE.Average) {
    const strength = rule.strength ?? 1
    const bearings = targets.map(bearingsOf)
    const averageLeft =
      bearings.reduce((sum, b) => sum + b.left, 0) / bearings.length
    const averageRight =
      bearings.reduce((sum, b) => sum + b.right, 0) / bearings.length

    targets.forEach((glyph, index) => {
      const { left, right } = bearings[index]
      result[glyph.index] = setSideBearings(
        glyph,
        Math.round(left + (averageLeft - left) * strength),
        Math.round(right + (averageRight - right) * strength),
      )
    })
    return result
  }

  for (const glyph of targets) {
    const { left, right } = bearingsOf(glyph)
    let nextLeft = left
    let nextRight = right

    switch (rule.mode) {
      case SPACING_MODE.Fixed:
        nextLeft = rule.left ?? left
        nextRight = rule.right ?? right
        break
      case SPACING_MODE.Scale: {
        const factor = rule.factor ?? 1
        nextLeft = left * factor
        nextRight = right * factor
        break
      }
      case SPACING_MODE.Minimum:
        nextLeft = Math.max(left, rule.left ?? 0)
        nextRight = Math.max(right, rule.right ?? 0)
        break
    }

    result[glyph.index] = setSideBearings(
      glyph,
      Math.round(nextLeft),
      Math.round(nextRight),
    )
  }

  return result
}

export interface SpacingStats {
  count: number
  averageLeft: number
  averageRight: number
  minLeft: number
  minRight: number
  maxLeft: number
  maxRight: number
  /** Standard deviation, a quick read on how even the spacing is. */
  deviationLeft: number
  deviationRight: number
}

export function spacingStats(
  glyphs: readonly ResolvedGlyph[],
): SpacingStats | null {
  const targets = glyphs.filter((glyph) => !glyph.isEmpty)
  if (targets.length === 0) return null

  const lefts = targets.map((glyph) => glyph.bounds.xMin)
  const rights = targets.map(
    (glyph) => glyph.advanceWidth - glyph.bounds.xMax,
  )

  const average = (values: number[]): number =>
    values.reduce((sum, v) => sum + v, 0) / values.length
  const deviation = (values: number[]): number => {
    if (values.length < 2) return 0
    const mean = average(values)
    return Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1),
    )
  }

  return {
    count: targets.length,
    averageLeft: average(lefts),
    averageRight: average(rights),
    minLeft: Math.min(...lefts),
    minRight: Math.min(...rights),
    maxLeft: Math.max(...lefts),
    maxRight: Math.max(...rights),
    deviationLeft: deviation(lefts),
    deviationRight: deviation(rights),
  }
}
