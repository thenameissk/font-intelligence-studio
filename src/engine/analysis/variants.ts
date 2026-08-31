/**
 * Variant discovery: what else could this glyph be?
 *
 * Every variant offered here is a real outline that already exists in the
 * imported font. Two sources supply them:
 *
 *   1. The font's own alternates. A face that ships a one-storey `a` exposes
 *      it through a GSUB feature such as `cv07` or `ss07`, and swapping it in
 *      is exactly what that feature was authored for.
 *   2. Structural twins. A handful of letters have a sibling code point that
 *      *is* the other construction -- U+0251 LATIN SMALL LETTER ALPHA is the
 *      one-storey `a`, U+0261 SCRIPT G is the single-storey `g`. When the
 *      font draws those, they are the same designer's take on the same
 *      letter and make an honest donor.
 *
 * Nothing is synthesised. Redrawing a two-storey `a` as a one-storey `a` is
 * a design decision, not a transformation, and inventing one would produce a
 * shape that belongs to no typeface. When a font offers nothing, the panel
 * says so rather than fabricating an answer.
 */
import type { Font as OTFont } from 'opentype.js'
import type { GlyphEdits } from '@/types/font'
import type { Outline, Rect } from '@/types/geometry'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { featureName } from '@/engine/parser/featureNames'
import {
  analyzeGlyphStructure,
  constructionLabel,
  CONSTRUCTION,
  type GlyphStructure,
} from './glyphStructure'

export const VARIANT_SOURCE = {
  Feature: 'feature',
  Donor: 'donor',
} as const
export type VariantSource =
  (typeof VARIANT_SOURCE)[keyof typeof VARIANT_SOURCE]

export interface VariantChange {
  id: string
  label: string
  detail: string
}

export interface GlyphVariant {
  id: string
  label: string
  detail: string
  source: VariantSource
  /** GSUB feature that offers this alternate, when that is the source. */
  featureTag?: string
  /** The glyph in this font that supplies the shape. */
  glyphIndex: number
  glyphName: string
  outline: Outline
  advanceWidth: number
  structure: GlyphStructure
  changes: VariantChange[]
}

/**
 * Features that offer a different letterform, as opposed to contextual
 * behaviour. Ligature, mark and composition features are not variants of a
 * single glyph, so they are left out.
 */
function isVariantFeature(tag: string): boolean {
  // `ordn`, `sups` and `subs` substitute a differently-sized glyph for a
  // different purpose rather than offering another drawing of this letter,
  // so they are not variants in the sense this panel means.
  if (/^(salt|aalt|hist|swsh|titl|zero)$/.test(tag)) return true
  if (/^ss\d\d$/.test(tag)) return true
  if (/^cv\d\d$/.test(tag)) return true
  return false
}

/**
 * A real alternate of a letter keeps that letter's proportions. A candidate
 * that is dramatically shorter or taller is a superscript, a small cap or a
 * mis-mapped substitution, and offering it as "another form of a" would be
 * misleading however the font tagged it.
 */
function hasComparableProportions(
  current: { bounds: Rect; isEmpty: boolean },
  candidate: { bounds: Rect; isEmpty: boolean },
): boolean {
  if (current.isEmpty || candidate.isEmpty) return false
  const currentHeight = current.bounds.yMax - current.bounds.yMin
  const candidateHeight = candidate.bounds.yMax - candidate.bounds.yMin
  if (currentHeight <= 0 || candidateHeight <= 0) return false
  const ratio = candidateHeight / currentHeight
  return ratio > 0.7 && ratio < 1.45
}

/** Alternate glyph indices this font offers for `glyphIndex`, by feature. */
export function findFeatureAlternates(
  font: OTFont,
  glyphIndex: number,
): Array<{ tag: string; target: number }> {
  const results: Array<{ tag: string; target: number }> = []
  const tags = [
    ...new Set(
      ((font.tables.gsub?.features ?? []) as Array<{ tag?: string }>)
        .map((entry) => entry.tag)
        .filter((tag): tag is string => typeof tag === 'string'),
    ),
  ].filter(isVariantFeature)

  for (const tag of tags) {
    try {
      const singles = font.substitution.getSingle(tag) ?? []
      for (const entry of singles) {
        if (entry.sub === glyphIndex && typeof entry.by === 'number') {
          results.push({ tag, target: entry.by })
        }
      }
      const alternates = font.substitution.getAlternates(tag) ?? []
      for (const entry of alternates) {
        if (entry.sub !== glyphIndex || !Array.isArray(entry.by)) continue
        for (const target of entry.by) results.push({ tag, target })
      }
    } catch {
      // A feature we cannot read is simply not offered.
    }
  }
  return results
}

/**
 * Letters with a sibling code point that draws the other construction.
 * Deliberately short: a donor is only honest when the sibling really is the
 * same letter in another form, not merely a similar shape.
 */
const STRUCTURAL_TWINS: Record<string, Array<{ codepoint: number; label: string; detail: string }>> = {
  a: [
    {
      codepoint: 0x0251,
      label: 'One-storey a',
      detail: 'Drawn from this font’s Latin alpha (U+0251), the single-storey form of a.',
    },
  ],
  g: [
    {
      codepoint: 0x0261,
      label: 'Single-storey g',
      detail: 'Drawn from this font’s script g (U+0261), the single-storey form of g.',
    },
  ],
  'ɑ': [
    {
      codepoint: 0x0061,
      label: 'Two-storey a',
      detail: 'Drawn from this font’s a, the double-storey form.',
    },
  ],
  'ɡ': [
    {
      codepoint: 0x0067,
      label: 'Double-storey g',
      detail: 'Drawn from this font’s g.',
    },
  ],
}

function describeFeature(tag: string): string {
  if (/^ss\d\d$/.test(tag)) return `Stylistic set ${tag.slice(2)}`
  if (/^cv\d\d$/.test(tag)) return `Character variant ${tag.slice(2)}`
  return featureName(tag)
}

/** Plain-language differences between the current glyph and a candidate. */
export function describeChanges(
  current: { structure: GlyphStructure; advanceWidth: number },
  candidate: { structure: GlyphStructure; advanceWidth: number },
  unitsPerEm: number,
): VariantChange[] {
  const changes: VariantChange[] = []

  if (
    current.structure.construction !== CONSTRUCTION.Unknown &&
    candidate.structure.construction !== CONSTRUCTION.Unknown &&
    current.structure.construction !== candidate.structure.construction
  ) {
    changes.push({
      id: 'construction',
      label: 'Construction',
      detail: `${constructionLabel(current.structure.construction)} → ${constructionLabel(
        candidate.structure.construction,
      )}`,
    })
  }

  const counterDelta =
    candidate.structure.counters.length - current.structure.counters.length
  if (counterDelta !== 0) {
    changes.push({
      id: 'counters',
      label: 'Counters',
      detail:
        counterDelta > 0
          ? `${counterDelta} more enclosed counter${counterDelta === 1 ? '' : 's'}`
          : `${-counterDelta} fewer enclosed counter${counterDelta === -1 ? '' : 's'}`,
    })
  }

  const hadTail = current.structure.tail !== null
  const hasTail = candidate.structure.tail !== null
  if (hadTail !== hasTail) {
    changes.push({
      id: 'tail',
      label: 'Tail',
      detail: hasTail ? 'Gains a tail at the baseline' : 'Loses the tail at the baseline',
    })
  } else if (current.structure.tail && candidate.structure.tail) {
    const delta = candidate.structure.tail.reach - current.structure.tail.reach
    if (Math.abs(delta) > unitsPerEm * 0.015) {
      changes.push({
        id: 'tail-reach',
        label: 'Tail',
        detail: `Reaches ${Math.abs(Math.round(delta))} units ${delta > 0 ? 'further' : 'less far'}`,
      })
    }
  }

  const a = current.structure.junction
  const b = candidate.structure.junction
  if (a && b) {
    const delta = b.thickness - a.thickness
    if (Math.abs(delta) > Math.max(4, a.thickness * 0.12)) {
      changes.push({
        id: 'junction',
        label: delta > 0 ? 'Thicker join' : 'Thinner join',
        detail: `Narrowest join ${Math.round(a.thickness)} → ${Math.round(b.thickness)} units`,
      })
    }
  }

  const widthDelta = candidate.advanceWidth - current.advanceWidth
  if (Math.abs(widthDelta) > unitsPerEm * 0.005) {
    changes.push({
      id: 'width',
      label: 'Advance',
      detail: `${widthDelta > 0 ? '+' : ''}${Math.round(widthDelta)} units`,
    })
  }

  return changes
}

export interface SuggestOptions {
  /** Ignore candidates whose outline is identical to the current one. */
  skipIdentical?: boolean
}

export function suggestVariants(
  parsed: ParsedFont,
  edits: GlyphEdits,
  glyphIndex: number,
  options: SuggestOptions = {},
): GlyphVariant[] {
  const source = parsed.glyphs[glyphIndex]
  if (!source) return []

  const current = resolveGlyph(parsed, edits, glyphIndex)
  const char =
    current.unicode !== null ? String.fromCodePoint(current.unicode) : null
  const currentStructure = analyzeGlyphStructure(current.outline, { char })
  const upm = parsed.verticalMetrics.unitsPerEm

  const seen = new Set<number>([glyphIndex])
  const variants: GlyphVariant[] = []

  const add = (
    targetIndex: number,
    partial: {
      id: string
      label: string
      detail: string
      source: VariantSource
      featureTag?: string
    },
  ): void => {
    if (seen.has(targetIndex)) return
    if (targetIndex < 0 || targetIndex >= parsed.glyphs.length) return

    const candidate = resolveGlyph(parsed, {}, targetIndex)
    if (candidate.isEmpty) return
    if (!hasComparableProportions(current, candidate)) return
    seen.add(targetIndex)

    const structure = analyzeGlyphStructure(candidate.outline, { char })
    const changes = describeChanges(
      { structure: currentStructure, advanceWidth: current.advanceWidth },
      { structure, advanceWidth: candidate.advanceWidth },
      upm,
    )
    if (options.skipIdentical !== false && changes.length === 0) {
      // Identical readings usually mean the same drawing under another name.
      const sameBounds =
        Math.abs(candidate.bounds.xMin - current.bounds.xMin) < 1 &&
        Math.abs(candidate.bounds.xMax - current.bounds.xMax) < 1 &&
        Math.abs(candidate.bounds.yMin - current.bounds.yMin) < 1 &&
        Math.abs(candidate.bounds.yMax - current.bounds.yMax) < 1
      if (sameBounds) return
    }

    variants.push({
      ...partial,
      glyphIndex: targetIndex,
      glyphName: candidate.name,
      outline: candidate.outline,
      advanceWidth: candidate.advanceWidth,
      structure,
      changes,
    })
  }

  for (const { tag, target } of findFeatureAlternates(parsed.otFont, glyphIndex)) {
    const targetStructure = analyzeGlyphStructure(
      resolveGlyph(parsed, {}, target).outline,
      { char },
    )
    // Name the variant after what it actually is, falling back to the
    // feature's own name when the shape reads the same as the original.
    const structural =
      targetStructure.construction !== CONSTRUCTION.Unknown &&
      targetStructure.construction !== currentStructure.construction
        ? `${constructionLabel(targetStructure.construction)} ${char ?? source.name}`
        : null

    add(target, {
      id: `feature-${tag}-${target}`,
      label: structural ?? describeFeature(tag),
      detail: `Offered by this font as ${tag.toUpperCase()} · ${describeFeature(tag)}`,
      source: VARIANT_SOURCE.Feature,
      featureTag: tag,
    })
  }

  for (const twin of char ? (STRUCTURAL_TWINS[char] ?? []) : []) {
    const target = parsed.cmap.get(twin.codepoint)
    if (target === undefined) continue
    add(target, {
      id: `donor-${twin.codepoint}`,
      label: twin.label,
      detail: twin.detail,
      source: VARIANT_SOURCE.Donor,
    })
  }

  return variants
}

export interface VariantReport {
  structure: GlyphStructure
  variants: GlyphVariant[]
  /** Why nothing was found, when nothing was. */
  emptyReason: string | null
}

export function analyzeVariants(
  parsed: ParsedFont,
  edits: GlyphEdits,
  glyphIndex: number,
): VariantReport {
  const current = resolveGlyph(parsed, edits, glyphIndex)
  const char =
    current.unicode !== null ? String.fromCodePoint(current.unicode) : null
  const structure = analyzeGlyphStructure(current.outline, { char })
  const variants = suggestVariants(parsed, edits, glyphIndex)

  let emptyReason: string | null = null
  if (variants.length === 0) {
    const hasAnyVariantFeature = (
      (parsed.otFont.tables.gsub?.features ?? []) as Array<{ tag?: string }>
    ).some((entry) => typeof entry.tag === 'string' && isVariantFeature(entry.tag))

    emptyReason = current.isEmpty
      ? 'This glyph has no outline to compare.'
      : hasAnyVariantFeature
        ? 'This font declares alternate features, but none of them offer another form of this glyph.'
        : 'This font ships no alternate letterforms for this glyph. Redrawing it in another construction is a design decision, so nothing is suggested rather than inventing a shape.'
  }

  return { structure, variants, emptyReason }
}
