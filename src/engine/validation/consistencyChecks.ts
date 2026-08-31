/**
 * Cross-glyph consistency checks.
 *
 * These are the ones that need the whole font in view: a side bearing is
 * only "abnormal" relative to its peers, and a stem is only "inconsistent"
 * compared with the stems it is meant to match.
 *
 * Outliers are found with the median and the median absolute deviation
 * rather than the mean and standard deviation, because a handful of genuine
 * outliers (a wide 'W', a zero-width mark) would otherwise drag the mean
 * and hide the real problems.
 */
import type { Issue } from '@/types/validation'
import { ISSUE_CODE } from '@/types/validation'
import type { ResolvedGlyph } from '@/types/font'
import { measureVerticalStem, median } from '@/engine/analysis/measure'
import { availableGroups, type RelationshipLookup } from '@/engine/relationships/relationships'

let counter = 0
function makeIssue(
  code: Issue['code'],
  severity: Issue['severity'],
  glyph: ResolvedGlyph | null,
  title: string,
  detail: string,
): Issue {
  counter += 1
  return {
    id: `cons${counter}`,
    code,
    severity,
    title,
    detail,
    glyphIndex: glyph?.index ?? null,
    glyphName: glyph?.name ?? null,
  }
}

export function resetConsistencyIds(): void {
  counter = 0
}

/** Median absolute deviation, scaled to be comparable with a std deviation. */
function medianAbsoluteDeviation(values: number[], centre: number): number {
  const deviations = values.map((value) => Math.abs(value - centre))
  return (median(deviations) ?? 0) * 1.4826
}

export interface ConsistencyContext {
  unitsPerEm: number
  xHeight: number | null
  capHeight: number | null
  lookup: RelationshipLookup
  glyphByIndex: (index: number) => ResolvedGlyph | null
}

/**
 * Side bearings that sit far outside the distribution for Latin letters.
 * Only letters are compared, since punctuation is spaced by other rules.
 */
export function checkSideBearings(
  letters: readonly ResolvedGlyph[],
): Issue[] {
  const solid = letters.filter((glyph) => !glyph.isEmpty)
  if (solid.length < 8) return []

  const issues: Issue[] = []
  for (const side of ['left', 'right'] as const) {
    const values = solid.map((glyph) =>
      side === 'left'
        ? glyph.bounds.xMin
        : glyph.advanceWidth - glyph.bounds.xMax,
    )
    const centre = median(values)!
    const spread = medianAbsoluteDeviation(values, centre)
    if (spread < 1) continue

    solid.forEach((glyph, index) => {
      const value = values[index]
      const deviation = Math.abs(value - centre) / spread
      if (deviation > 4) {
        issues.push(
          makeIssue(
            ISSUE_CODE.AbnormalSideBearing,
            'warning',
            glyph,
            `Unusual ${side} side bearing`,
            `${glyph.name} has a ${side} bearing of ${Math.round(value)} units, against a median of ${Math.round(centre)} across the alphabet.`,
          ),
        )
      }
    })
  }
  return issues
}

/** Figures are normally all one width; flag the ones that are not. */
export function checkFigureWidths(
  context: ConsistencyContext,
): Issue[] {
  const figures = '0123456789'
    .split('')
    .map((char) => context.lookup.charToIndex(char))
    .filter((index): index is number => index !== null)
    .map((index) => context.glyphByIndex(index))
    .filter((glyph): glyph is ResolvedGlyph => glyph !== null && !glyph.isEmpty)

  if (figures.length < 8) return []

  const widths = figures.map((glyph) => glyph.advanceWidth)
  const centre = median(widths)!
  if (centre <= 0) return []

  const tolerance = Math.max(2, centre * 0.02)
  const off = figures.filter(
    (glyph) => Math.abs(glyph.advanceWidth - centre) > tolerance,
  )

  // A proportional figure set is a deliberate design choice, not a defect.
  if (off.length > figures.length / 2) return []

  return off.map((glyph) =>
    makeIssue(
      ISSUE_CODE.InconsistentWidth,
      'warning',
      glyph,
      'Figure width differs from the set',
      `${glyph.name} is ${Math.round(glyph.advanceWidth)} units wide while most figures are ${Math.round(centre)}. Tabular figures should all match.`,
    ),
  )
}

/** Round glyphs overshoot flat ones slightly; a lot is a mistake. */
export function checkOvershoot(context: ConsistencyContext): Issue[] {
  const issues: Issue[] = []
  const pairs: Array<[round: string, flat: string, reference: number | null]> = [
    ['O', 'H', context.capHeight],
    ['o', 'x', context.xHeight],
  ]

  for (const [roundChar, flatChar, reference] of pairs) {
    if (reference === null || reference <= 0) continue
    const roundIndex = context.lookup.charToIndex(roundChar)
    const flatIndex = context.lookup.charToIndex(flatChar)
    if (roundIndex === null || flatIndex === null) continue

    const round = context.glyphByIndex(roundIndex)
    const flat = context.glyphByIndex(flatIndex)
    if (!round || !flat || round.isEmpty || flat.isEmpty) continue

    const overshoot = round.bounds.yMax - flat.bounds.yMax
    const ratio = overshoot / reference

    if (ratio > 0.035) {
      issues.push(
        makeIssue(
          ISSUE_CODE.ExtremeOvershoot,
          'warning',
          round,
          'Extreme overshoot',
          `${roundChar} rises ${Math.round(overshoot)} units above ${flatChar}, which is ${(ratio * 100).toFixed(1)}% of the reference height. Typical overshoot is around 1%.`,
        ),
      )
    } else if (ratio < -0.005) {
      issues.push(
        makeIssue(
          ISSUE_CODE.ExtremeOvershoot,
          'info',
          round,
          'Round glyph sits below the flat one',
          `${roundChar} is ${Math.round(-overshoot)} units lower than ${flatChar}. Round shapes normally overshoot slightly so they look the same height.`,
        ),
      )
    }
  }
  return issues
}

/** Stems that should match across a relationship group, but do not. */
export function checkStemConsistency(context: ConsistencyContext): Issue[] {
  const issues: Issue[] = []

  for (const { group, indices } of availableGroups(context.lookup)) {
    if (group.kind !== 'shape' || indices.length < 3) continue

    const measurements: Array<{ glyph: ResolvedGlyph; stem: number }> = []
    for (const index of indices) {
      const glyph = context.glyphByIndex(index)
      if (!glyph || glyph.isEmpty) continue
      const height = glyph.bounds.yMax - glyph.bounds.yMin
      if (height <= 0) continue
      const stem = measureVerticalStem(glyph.outline, {
        from: glyph.bounds.yMin + height * 0.35,
        to: glyph.bounds.yMin + height * 0.65,
        samples: 9,
      })
      if (stem !== null && stem > 0) measurements.push({ glyph, stem })
    }
    if (measurements.length < 3) continue

    const stems = measurements.map((m) => m.stem)
    const centre = median(stems)!
    if (centre <= 0) continue

    for (const { glyph, stem } of measurements) {
      const drift = Math.abs(stem - centre) / centre
      if (drift > 0.28) {
        issues.push(
          makeIssue(
            ISSUE_CODE.InconsistentStem,
            'warning',
            glyph,
            'Stem weight out of step',
            `${glyph.name} measures ${Math.round(stem)} units where the "${group.label}" group averages ${Math.round(centre)} — a ${(drift * 100).toFixed(0)}% difference.`,
          ),
        )
      }
    }
  }
  return issues
}

/** Letters whose height is wildly out of line with their peers. */
export function checkProportions(
  letters: readonly ResolvedGlyph[],
  context: ConsistencyContext,
): Issue[] {
  const solid = letters.filter((glyph) => !glyph.isEmpty)
  if (solid.length < 8) return []

  const widths = solid.map((glyph) => glyph.advanceWidth)
  const centre = median(widths)!
  const spread = medianAbsoluteDeviation(widths, centre)
  if (spread < 1) return []

  const issues: Issue[] = []
  solid.forEach((glyph, index) => {
    const deviation = (widths[index] - centre) / spread
    // Wide letters like W and M are normal; only extremes are worth a look.
    if (Math.abs(deviation) > 6) {
      issues.push(
        makeIssue(
          ISSUE_CODE.UnusualProportion,
          'info',
          glyph,
          'Unusual width',
          `${glyph.name} is ${Math.round(widths[index])} units wide against a median of ${Math.round(centre)} for this alphabet.`,
        ),
      )
    }
  })

  void context
  return issues
}
