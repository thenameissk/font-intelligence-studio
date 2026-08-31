/**
 * The font QA pass.
 *
 * Runs the per-glyph structural checks over every glyph, then the
 * cross-glyph consistency checks, and scores the result. The score is a
 * summary for the header -- the issue list is the part that matters, and
 * every entry points at a specific glyph.
 */
import type { Issue, ValidationReport } from '@/types/validation'
import { ISSUE_CODE } from '@/types/validation'
import type { GlyphEdits, ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { RECOMMENDED_CODEPOINTS } from '@/engine/parser/unicode'
import { analyzeFontDna } from '@/engine/analysis/fontDna'
import { createDnaSource } from '@/engine/analysis/dnaSource'
import { checkGlyph, resetIssueIds } from './glyphChecks'
import {
  checkFigureWidths,
  checkOvershoot,
  checkProportions,
  checkSideBearings,
  checkStemConsistency,
  resetConsistencyIds,
  type ConsistencyContext,
} from './consistencyChecks'

/** Above this many glyphs, checking stops so QA stays interactive. */
const MAX_GLYPHS = 5000

export interface ValidationOptions {
  /** Skip the whole-font consistency pass (used for a fast recheck). */
  skipConsistency?: boolean
  maxGlyphs?: number
}

export function runValidation(
  parsed: ParsedFont,
  edits: GlyphEdits,
  options: ValidationOptions = {},
): ValidationReport {
  const started = Date.now()
  resetIssueIds()
  resetConsistencyIds()

  const limit = options.maxGlyphs ?? MAX_GLYPHS
  const total = parsed.glyphs.length
  const checkCount = Math.min(total, limit)
  const truncated = checkCount < total

  const context = {
    unitsPerEm: parsed.verticalMetrics.unitsPerEm,
    outlineFormat: parsed.metadata.outlineFormat,
  }

  const issues: Issue[] = []
  const glyphsWithIssues = new Set<number>()

  for (let index = 0; index < checkCount; index += 1) {
    const glyph = resolveGlyph(parsed, edits, index)
    const found = checkGlyph(glyph, context)
    if (found.length > 0) {
      issues.push(...found)
      glyphsWithIssues.add(index)
    }
  }

  // Encoded glyphs that draw nothing are usually an oversight, though space
  // and the other blank characters are perfectly legitimate.
  const BLANKS = new Set([0x20, 0xa0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
    0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x200b, 0x202f, 0x205f, 0x3000])
  for (const entry of parsed.index) {
    if (entry.index >= checkCount) break
    if (entry.unicode === null || !entry.isEmpty) continue
    if (BLANKS.has(entry.unicode)) continue
    const glyph = resolveGlyph(parsed, edits, entry.index)
    if (!glyph.isEmpty) continue
    issues.push({
      id: `empty${entry.index}`,
      code: ISSUE_CODE.EmptyEncodedGlyph,
      severity: 'info',
      title: 'Encoded glyph has no outline',
      detail: `${entry.name} is mapped to U+${entry.unicode.toString(16).toUpperCase().padStart(4, '0')} but draws nothing.`,
      glyphIndex: entry.index,
      glyphName: entry.name,
    })
    glyphsWithIssues.add(entry.index)
  }

  const missingRecommended = RECOMMENDED_CODEPOINTS.filter(
    (codepoint) => !parsed.cmap.has(codepoint),
  )
  if (missingRecommended.length > 0) {
    issues.push({
      id: 'missing-coverage',
      code: ISSUE_CODE.MissingGlyph,
      severity: 'info',
      title: `${missingRecommended.length} recommended glyphs missing`,
      detail:
        'These code points are expected of a general-purpose Latin font. Browse them under "Missing" in the glyph list.',
      glyphIndex: null,
      glyphName: null,
    })
  }

  if (!options.skipConsistency) {
    issues.push(...runConsistency(parsed, edits))
    for (const found of issues) {
      if (found.glyphIndex !== null) glyphsWithIssues.add(found.glyphIndex)
    }
  }

  const counts: Record<string, number> = {}
  let errorCount = 0
  let warningCount = 0
  let infoCount = 0

  // Scoring counts affected GLYPHS, not raw issues. A font with one badly
  // broken glyph should not score the same as one where every glyph is
  // slightly off, and a single glyph reporting eight overlaps should not
  // count eight times.
  const errorGlyphs = new Set<number>()
  const warningGlyphs = new Set<number>()
  const infoGlyphs = new Set<number>()

  for (const found of issues) {
    counts[found.code] = (counts[found.code] ?? 0) + 1
    const bucket =
      found.severity === 'error'
        ? errorGlyphs
        : found.severity === 'warning'
          ? warningGlyphs
          : infoGlyphs
    if (found.severity === 'error') errorCount += 1
    else if (found.severity === 'warning') warningCount += 1
    else infoCount += 1
    // Font-level issues are counted once against a synthetic slot.
    bucket.add(found.glyphIndex ?? -1)
  }

  // A glyph is charged at its worst severity only.
  for (const index of errorGlyphs) {
    warningGlyphs.delete(index)
    infoGlyphs.delete(index)
  }
  for (const index of warningGlyphs) infoGlyphs.delete(index)

  const denominator = Math.max(1, checkCount)
  const penalty =
    100 *
    ((errorGlyphs.size * 1 +
      warningGlyphs.size * 0.35 +
      infoGlyphs.size * 0.08) /
      denominator)
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)))

  return {
    score,
    glyphsChecked: checkCount,
    glyphsWithIssues: glyphsWithIssues.size,
    issues: sortIssues(issues),
    counts,
    errorCount,
    warningCount,
    infoCount,
    missingRecommended,
    metricsValid: errorCount === 0,
    durationMs: Date.now() - started,
    truncated,
  }
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const

function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity
    if (a.code !== b.code) return a.code.localeCompare(b.code)
    return (a.glyphIndex ?? -1) - (b.glyphIndex ?? -1)
  })
}

function runConsistency(parsed: ParsedFont, edits: GlyphEdits): Issue[] {
  const dna = analyzeFontDna(createDnaSource(parsed, edits))

  const glyphCache = new Map<number, ResolvedGlyph | null>()
  const glyphByIndex = (index: number): ResolvedGlyph | null => {
    if (glyphCache.has(index)) return glyphCache.get(index) ?? null
    const glyph =
      index >= 0 && index < parsed.glyphs.length
        ? resolveGlyph(parsed, edits, index)
        : null
    glyphCache.set(index, glyph)
    return glyph
  }

  const lookup = {
    charToIndex: (char: string): number | null => {
      const codepoint = char.codePointAt(0)
      return codepoint === undefined ? null : (parsed.cmap.get(codepoint) ?? null)
    },
    indexToChar: (index: number): string | null => {
      const unicode = parsed.glyphs[index]?.unicode
      return unicode === null || unicode === undefined
        ? null
        : String.fromCodePoint(unicode)
    },
  }

  const context: ConsistencyContext = {
    unitsPerEm: parsed.verticalMetrics.unitsPerEm,
    xHeight: dna.xHeight.value,
    capHeight: dna.capHeight.value,
    lookup,
    glyphByIndex,
  }

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    .split('')
    .map((char) => lookup.charToIndex(char))
    .filter((index): index is number => index !== null)
    .map(glyphByIndex)
    .filter((glyph): glyph is ResolvedGlyph => glyph !== null)

  return [
    ...checkSideBearings(letters),
    ...checkFigureWidths(context),
    ...checkOvershoot(context),
    ...checkStemConsistency(context),
    ...checkProportions(letters, context),
  ]
}
