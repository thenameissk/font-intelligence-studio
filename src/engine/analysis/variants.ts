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
  /** Every feature that reaches this alternate; a font may file one under several. */
  featureTags?: string[]
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
  // `ordn`, `sups`, `subs`, `numr`, `dnom` and `frac` substitute a
  // differently-sized glyph for a different purpose rather than offering
  // another drawing of this letter, so they are not variants in the sense
  // this panel means.
  if (/^(salt|aalt|hist|swsh|titl|zero)$/.test(tag)) return true
  if (/^ss\d\d$/.test(tag)) return true
  if (/^cv\d\d$/.test(tag)) return true

  // Figures have as many forms as letters do: oldstyle against lining,
  // tabular against proportional. Each is a different drawing of the same
  // digit, which is exactly what this panel is for.
  if (/^(onum|lnum|tnum|pnum)$/.test(tag)) return true

  // A localised form is the same character drawn the way a particular
  // language expects it -- a real alternate, not a different letter.
  if (tag === 'locl') return true

  // Small caps are another drawing of the same letter. They survive the
  // proportion check only when they are close enough in height to be
  // offered honestly as an alternate rather than as a different size.
  if (/^(smcp|c2sc|case)$/.test(tag)) return true

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

/**
 * Every substitution the font's variant features declare, as an undirected
 * graph over glyph indices.
 *
 * Undirected is the whole point. A face maps `a -> a.1` under `cv07`, and
 * nothing maps back, so scanning only forwards means the default `a` offers
 * its alternate while the alternate itself offers nothing at all -- the same
 * font answering the same question differently depending on which of the two
 * glyphs you happen to be looking at. Reading the edge both ways also gives
 * siblings for free: when `a -> a.1` and `a -> a.2` are both declared, all
 * three are forms of one letter and each should offer the other two.
 *
 * Every tag that declares an edge is kept, because `cv07` and `ss07` reaching
 * the same glyph is worth saying once with both names rather than twice.
 */
interface AlternateEdge {
  target: number
  tags: string[]
  /** True when the font substitutes *away* from the glyph being asked about. */
  forward: boolean
}

type AlternateGraph = Map<number, Map<number, { tags: Set<string>; forward: boolean }>>

const GRAPH_CACHE = new WeakMap<OTFont, AlternateGraph>()

function buildAlternateGraph(font: OTFont): AlternateGraph {
  const graph: AlternateGraph = new Map()

  const link = (from: number, to: number, tag: string, forward: boolean): void => {
    if (from === to) return
    let edges = graph.get(from)
    if (!edges) graph.set(from, (edges = new Map()))
    const existing = edges.get(to)
    if (existing) {
      existing.tags.add(tag)
      // A pair joined in both directions is described as a substitution the
      // font offers, not as a way back to the default.
      existing.forward = existing.forward || forward
    } else {
      edges.set(to, { tags: new Set([tag]), forward })
    }
  }

  const tags = [
    ...new Set(
      ((font.tables.gsub?.features ?? []) as Array<{ tag?: string }>)
        .map((entry) => entry.tag)
        .filter((tag): tag is string => typeof tag === 'string'),
    ),
  ].filter(isVariantFeature)

  for (const tag of tags) {
    try {
      for (const entry of font.substitution.getSingle(tag) ?? []) {
        if (typeof entry.sub !== 'number' || typeof entry.by !== 'number') continue
        link(entry.sub, entry.by, tag, true)
        link(entry.by, entry.sub, tag, false)
      }
      for (const entry of font.substitution.getAlternates(tag) ?? []) {
        if (typeof entry.sub !== 'number' || !Array.isArray(entry.by)) continue
        for (const target of entry.by) {
          if (typeof target !== 'number') continue
          link(entry.sub, target, tag, true)
          link(target, entry.sub, tag, false)
        }
        // Alternates listed together under one feature are forms of the same
        // letter, so they are siblings of each other too.
        for (const a of entry.by) {
          for (const b of entry.by) {
            if (typeof a !== 'number' || typeof b !== 'number') continue
            link(a, b, tag, false)
          }
        }
      }
    } catch {
      // A feature we cannot read is simply not offered.
    }
  }

  return graph
}

function alternateGraph(font: OTFont): AlternateGraph {
  let cached = GRAPH_CACHE.get(font)
  if (!cached) {
    cached = buildAlternateGraph(font)
    GRAPH_CACHE.set(font, cached)
  }
  return cached
}

/**
 * Alternate glyphs this font offers for `glyphIndex`.
 *
 * Direct edges are the glyph's own alternates and, read the other way, the
 * default form it was substituted from. Siblings are then added: two glyphs
 * are alternates of each other when they share a default, which is how
 * `a.1` comes to offer the small cap that `a` also points at.
 *
 * The sibling step deliberately walks backwards first and only then
 * forwards. Walking forwards first and backwards second looks equivalent
 * and is not: from `a` it reaches the small cap `A.sc` through `smcp`, and
 * from there the capital `A` through `c2sc` -- offering a capital A as a
 * variant of lowercase a. Requiring a shared default keeps every suggestion
 * a form of the same character.
 */
export function findFeatureAlternates(
  font: OTFont,
  glyphIndex: number,
): AlternateEdge[] {
  const graph = alternateGraph(font)
  const found = new Map<number, { tags: Set<string>; forward: boolean }>()

  const direct = graph.get(glyphIndex)
  if (!direct) return []

  for (const [target, edge] of direct) {
    found.set(target, { tags: new Set(edge.tags), forward: edge.forward })
  }

  // A backward edge names a default this glyph was substituted from; that
  // default's other alternates are this glyph's siblings.
  for (const [neighbour, edge] of direct) {
    if (edge.forward) continue
    for (const [target, sibling] of graph.get(neighbour) ?? []) {
      if (!sibling.forward) continue
      if (target === glyphIndex || found.has(target)) continue
      found.set(target, { tags: new Set(sibling.tags), forward: false })
    }
  }

  return [...found]
    .map(([target, edge]) => ({
      target,
      tags: [...edge.tags].sort(),
      forward: edge.forward,
    }))
    .sort((a, b) => a.target - b.target)
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

const FEATURE_LABELS: Record<string, string> = {
  smcp: 'Small capitals',
  c2sc: 'Capitals as small capitals',
  case: 'Case-sensitive form',
  locl: 'Localised form',
  onum: 'Oldstyle figure',
  lnum: 'Lining figure',
  tnum: 'Tabular figure',
  pnum: 'Proportional figure',
  salt: 'Stylistic alternate',
  aalt: 'Access all alternates',
  hist: 'Historical form',
  swsh: 'Swash',
  titl: 'Titling form',
  zero: 'Slashed zero',
}

function describeFeature(tag: string): string {
  if (/^ss\d\d$/.test(tag)) return `Stylistic set ${tag.slice(2)}`
  if (/^cv\d\d$/.test(tag)) return `Character variant ${tag.slice(2)}`
  const known = FEATURE_LABELS[tag]
  if (known) return known
  const named = featureName(tag)
  // Better the raw tag than the words "Unknown feature".
  return named === 'Unknown feature' ? tag.toUpperCase() : named
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

/** A candidate the font offered that is not honestly a form of this letter. */
export interface RejectedVariant {
  glyphName: string
  reason: string
}

export function suggestVariants(
  parsed: ParsedFont,
  edits: GlyphEdits,
  glyphIndex: number,
  options: SuggestOptions = {},
): GlyphVariant[] {
  return collectVariants(parsed, edits, glyphIndex, options).variants
}

function collectVariants(
  parsed: ParsedFont,
  edits: GlyphEdits,
  glyphIndex: number,
  options: SuggestOptions = {},
): { variants: GlyphVariant[]; rejected: RejectedVariant[] } {
  const source = parsed.glyphs[glyphIndex]
  if (!source) return { variants: [], rejected: [] }

  const current = resolveGlyph(parsed, edits, glyphIndex)
  const char =
    current.unicode !== null ? String.fromCodePoint(current.unicode) : null
  const currentStructure = analyzeGlyphStructure(current.outline, { char })
  const upm = parsed.verticalMetrics.unitsPerEm

  const seen = new Set<number>([glyphIndex])
  const variants: GlyphVariant[] = []
  const rejected: RejectedVariant[] = []

  const add = (
    targetIndex: number,
    partial: {
      id: string
      label: string
      detail: string
      source: VariantSource
      featureTag?: string
      featureTags?: string[]
    },
  ): void => {
    if (seen.has(targetIndex)) return
    if (targetIndex < 0 || targetIndex >= parsed.glyphs.length) return

    const candidate = resolveGlyph(parsed, {}, targetIndex)
    if (candidate.isEmpty) return
    if (!hasComparableProportions(current, candidate)) {
      // Worth saying out loud. Open Sans lists `a -> ordfeminine` under
      // aalt, and dropping it without a word looks identical to finding
      // nothing at all -- which is the difference between "this font has no
      // other a" and "this font is hiding one from you".
      const height = candidate.bounds.yMax - candidate.bounds.yMin
      const reference = current.bounds.yMax - current.bounds.yMin
      rejected.push({
        glyphName: candidate.name,
        reason:
          reference > 0 && height > 0
            ? `${candidate.name} is ${Math.round((height / reference) * 100)}% of this letter's height, so it is a different character rather than another form of it`
            : `${candidate.name} has no comparable outline`,
      })
      return
    }
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

  for (const { target, tags, forward } of findFeatureAlternates(
    parsed.otFont,
    glyphIndex,
  )) {
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

    // Both names are worth giving when a font files one drawing under a
    // stylistic set and a character variant at once.
    const named = tags.map(describeFeature).join(' · ')
    const codes = tags.map((tag) => tag.toUpperCase()).join(', ')
    const detail = forward
      ? `Offered by this font as ${codes} · ${named}`
      : `The form this font substitutes under ${codes} · ${named}`

    add(target, {
      id: `feature-${tags.join('-')}-${target}`,
      label: structural ?? named,
      detail,
      source: VARIANT_SOURCE.Feature,
      featureTag: tags[0],
      featureTags: tags,
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

  return { variants, rejected }
}

export interface VariantReport {
  structure: GlyphStructure
  variants: GlyphVariant[]
  /** Why nothing was found, when nothing was. */
  emptyReason: string | null
  /** Candidates the font offered that are not forms of this letter. */
  rejected: RejectedVariant[]
  /**
   * Letters this font *does* give alternates for, when it gives none here.
   *
   * "This font has no other a" and "this font has alternates, just not for
   * a" look identical when both say nothing, and they are very different
   * facts. Open Sans ships a single-storey g and three stylistic sets, and
   * none of them touch the a.
   */
  alternatesElsewhere: { count: number; examples: string[] }
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
  const { variants, rejected } = collectVariants(parsed, edits, glyphIndex)

  let emptyReason: string | null = null
  let alternatesElsewhere = { count: 0, examples: [] as string[] }

  if (variants.length === 0) {
    alternatesElsewhere = summariseAlternates(parsed, glyphIndex)

    emptyReason = current.isEmpty
      ? 'This glyph has no outline to compare.'
      : alternatesElsewhere.count > 0
        ? `This font ships alternates for ${alternatesElsewhere.count} other glyph${
            alternatesElsewhere.count === 1 ? '' : 's'
          }, but none for this one.`
        : 'This font ships no alternate letterforms at all. Redrawing this letter in another construction is a design decision, so nothing is suggested rather than inventing a shape.'
  }

  return { structure, variants, emptyReason, rejected, alternatesElsewhere }
}

/**
 * How many other glyphs this font gives alternates for, with a few named.
 *
 * Only glyphs the font substitutes *away from* are counted -- the defaults
 * that have another form -- because counting the alternates as well would
 * double every letter.
 */
function summariseAlternates(
  parsed: ParsedFont,
  exclude: number,
): { count: number; examples: string[] } {
  const graph = alternateGraph(parsed.otFont)
  const examples: string[] = []
  let count = 0

  for (const [index, edges] of graph) {
    if (index === exclude) continue
    let forward = false
    for (const [, edge] of edges) {
      if (edge.forward) {
        forward = true
        break
      }
    }
    if (!forward) continue
    count += 1
    if (examples.length < 6) {
      const unicode = parsed.glyphs[index]?.unicode
      // Named by the character where there is one, since `g` reads better
      // than `uni0067` to anyone deciding whether to look.
      if (unicode !== null && unicode !== undefined) {
        examples.push(String.fromCodePoint(unicode))
      }
    }
  }

  return { count, examples }
}
