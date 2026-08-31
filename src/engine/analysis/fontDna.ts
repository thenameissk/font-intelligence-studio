/**
 * Font DNA: a structural profile of a typeface measured from its outlines.
 *
 * Values fall into three kinds, and the UI shows which is which:
 *   - declared: read straight out of OS/2, post or hhea
 *   - measured: computed from real glyph geometry
 *   - estimated: a named bucket derived from measurements (a heuristic)
 */
import type {
  Classification,
  FontDna,
  Metric,
  StemMeasurement,
  WidthBucket,
} from '@/types/analysis'
import { CONFIDENCE } from '@/types/analysis'
import type { Outline, Rect } from '@/types/geometry'
import { outlineBounds } from '@/engine/geometry/outline'
import {
  mean,
  measureCorners,
  measureCurvature,
  measureHorizontalStroke,
  measureSerifRatio,
  measureSlant,
  measureStress,
  measureVerticalStem,
  median,
  rectAspect,
} from './measure'
import { WEIGHT_CLASS_NAMES } from './classification'

export interface AnalysisGlyph {
  name: string
  advanceWidth: number
  outline: Outline
  bounds: Rect
  isEmpty: boolean
}

export interface DnaSource {
  unitsPerEm: number
  declaredCapHeight: number | null
  declaredXHeight: number | null
  declaredAscender: number
  declaredDescender: number
  declaredItalicAngle: number
  declaredWeightClass: number | null
  declaredWidthClass: number | null
  byChar: (char: string) => AnalysisGlyph | null
  advanceWidths: () => number[]
  glyphHeights: () => number[]
}

const unavailable = (basis: string): Metric => ({
  value: null,
  confidence: CONFIDENCE.Unavailable,
  basis,
})

const measured = (value: number, basis: string): Metric => ({
  value,
  confidence: CONFIDENCE.Measured,
  basis,
})

const declared = (value: number, basis: string): Metric => ({
  value,
  confidence: CONFIDENCE.Declared,
  basis,
})

/** Highest point of the first available character in `chars`. */
function topOf(
  source: DnaSource,
  chars: string[],
): { value: number; char: string } | null {
  for (const char of chars) {
    const glyph = source.byChar(char)
    if (glyph && !glyph.isEmpty) {
      return { value: glyph.bounds.yMax, char }
    }
  }
  return null
}

function bottomOf(
  source: DnaSource,
  chars: string[],
): { value: number; char: string } | null {
  for (const char of chars) {
    const glyph = source.byChar(char)
    if (glyph && !glyph.isEmpty) {
      return { value: glyph.bounds.yMin, char }
    }
  }
  return null
}

function firstGlyph(source: DnaSource, chars: string[]): AnalysisGlyph | null {
  for (const char of chars) {
    const glyph = source.byChar(char)
    if (glyph && !glyph.isEmpty) return glyph
  }
  return null
}

// --------------------------------------------------------------------------
// Heuristic buckets. Thresholds are calibrated against a range of real
// families; they are labelled as estimates everywhere they surface.
// --------------------------------------------------------------------------

// Ratio of stem width to cap height, calibrated against Helvetica, Arial,
// Times, Georgia, Futura and their bold/black cuts.
const WEIGHT_BUCKETS: Array<[max: number, weight: number]> = [
  [0.055, 100],
  [0.07, 200],
  [0.098, 300],
  [0.145, 400],
  [0.165, 500],
  [0.19, 600],
  [0.235, 700],
  [0.275, 800],
  [Infinity, 900],
]

// Ratio of the 'H' advance to cap height.
const WIDTH_BUCKETS: Array<[max: number, label: string]> = [
  [0.62, 'Ultra Condensed'],
  [0.7, 'Extra Condensed'],
  [0.8, 'Condensed'],
  [0.9, 'Semi Condensed'],
  [1.22, 'Normal'],
  [1.35, 'Semi Expanded'],
  [1.5, 'Expanded'],
  [1.65, 'Extra Expanded'],
  [Infinity, 'Ultra Expanded'],
]

const CONTRAST_BUCKETS: Array<[max: number, label: string]> = [
  [0.06, 'Monolinear'],
  [0.18, 'Low'],
  [0.34, 'Moderate'],
  [0.55, 'High'],
  [Infinity, 'Very High'],
]

function bucket<T>(value: number, table: Array<[number, T]>): T {
  for (const [max, result] of table) {
    if (value < max) return result
  }
  return table[table.length - 1][1]
}

export function analyzeFontDna(source: DnaSource): FontDna {
  const upm = source.unitsPerEm
  const missingKeyGlyphs: string[] = []
  const track = (char: string): void => {
    if (!source.byChar(char)) missingKeyGlyphs.push(char)
  }
  for (const char of ['x', 'H', 'O', 'o', 'n', 'I', 'l', 'p', 'b']) track(char)

  // ---- Vertical proportions -------------------------------------------
  const xTop = topOf(source, ['x', 'z', 'v', 'w'])
  const capTop = topOf(source, ['H', 'E', 'I', 'T'])
  const ascTop = topOf(source, ['b', 'd', 'h', 'k', 'l'])
  const descBottom = bottomOf(source, ['p', 'q', 'y', 'g', 'j'])

  const xHeight: Metric = xTop
    ? measured(xTop.value, `measured from '${xTop.char}'`)
    : source.declaredXHeight !== null
      ? declared(source.declaredXHeight, 'OS/2 sxHeight')
      : unavailable('no lowercase reference glyph')

  const capHeight: Metric = capTop
    ? measured(capTop.value, `measured from '${capTop.char}'`)
    : source.declaredCapHeight !== null
      ? declared(source.declaredCapHeight, 'OS/2 sCapHeight')
      : unavailable('no uppercase reference glyph')

  const ascender: Metric = ascTop
    ? measured(ascTop.value, `measured from '${ascTop.char}'`)
    : declared(source.declaredAscender, 'hhea.ascender')

  const descender: Metric = descBottom
    ? measured(descBottom.value, `measured from '${descBottom.char}'`)
    : declared(source.declaredDescender, 'hhea.descender')

  const ratio = (metric: Metric, label: string): Metric =>
    metric.value === null || upm <= 0
      ? unavailable(label)
      : { value: metric.value / upm, confidence: metric.confidence, basis: label }

  // ---- Overshoot -------------------------------------------------------
  const roundCapTop = topOf(source, ['O', 'Q', 'C', 'G'])
  const capOvershoot: Metric =
    roundCapTop && capTop
      ? measured(
          roundCapTop.value - capTop.value,
          `'${roundCapTop.char}' vs '${capTop.char}'`,
        )
      : unavailable('needs a round and a flat capital')

  const roundXTop = topOf(source, ['o', 'e', 'c'])
  const xOvershoot: Metric =
    roundXTop && xTop
      ? measured(
          roundXTop.value - xTop.value,
          `'${roundXTop.char}' vs '${xTop.char}'`,
        )
      : unavailable('needs a round and a flat lowercase')

  // ---- Spacing ---------------------------------------------------------
  const spacingSample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    .split('')
    .map((char) => source.byChar(char))
    .filter((g): g is AnalysisGlyph => g !== null && !g.isEmpty)

  const advanceWidths = source.advanceWidths()
  const averageAdvanceWidth: Metric =
    advanceWidths.length > 0
      ? measured(mean(advanceWidths)!, `${advanceWidths.length} encoded glyphs`)
      : unavailable('no encoded glyphs')

  const lsbs = spacingSample.map((g) => g.bounds.xMin)
  const rsbs = spacingSample.map((g) => g.advanceWidth - g.bounds.xMax)

  const averageLeftSideBearing: Metric =
    lsbs.length > 0
      ? measured(mean(lsbs)!, `${lsbs.length} Latin letters`)
      : unavailable('no Latin letters')
  const averageRightSideBearing: Metric =
    rsbs.length > 0
      ? measured(mean(rsbs)!, `${rsbs.length} Latin letters`)
      : unavailable('no Latin letters')

  const heights = source.glyphHeights()
  const averageGlyphHeight: Metric =
    heights.length > 0
      ? measured(mean(heights)!, `${heights.length} non-empty glyphs`)
      : unavailable('no non-empty glyphs')

  // ---- Stems and contrast ----------------------------------------------
  const stemSamples: Array<{ glyph: string; width: number }> = []
  for (const char of ['H', 'I', 'l', 'n', 'i', 'E']) {
    const glyph = source.byChar(char)
    if (!glyph || glyph.isEmpty) continue
    const bounds = glyph.bounds
    const height = bounds.yMax - bounds.yMin
    // Sample above any crossbar so 'H' and 'E' report a stem, not a bar.
    const width = measureVerticalStem(glyph.outline, {
      from: bounds.yMin + height * 0.6,
      to: bounds.yMin + height * 0.9,
      samples: 15,
    })
    if (width !== null && width > 0) stemSamples.push({ glyph: char, width })
  }
  const stemWidth = median(stemSamples.map((s) => s.width))
  const verticalStem: StemMeasurement = {
    width:
      stemWidth === null
        ? unavailable('no measurable vertical stem')
        : measured(
            stemWidth,
            `median of ${stemSamples.length} stem${stemSamples.length === 1 ? '' : 's'}`,
          ),
    samples: stemSamples,
  }

  const ring = firstGlyph(source, ['O', 'o', 'D', 'Q'])
  const stress = ring ? measureStress(ring.outline) : null

  const horizontalStrokeValue = ring
    ? measureHorizontalStroke(ring.outline)
    : null
  const horizontalStroke: Metric =
    horizontalStrokeValue === null
      ? unavailable('no round glyph to measure')
      : measured(horizontalStrokeValue, `measured from '${ring!.name}'`)

  const contrast: Metric =
    stress && stress.thickest > 0
      ? measured(
          1 - stress.thinnest / stress.thickest,
          `thin/thick of '${ring!.name}'`,
        )
      : unavailable('no round glyph to measure')

  const contrastLabel: Classification =
    contrast.value === null
      ? { label: 'Unknown', confidence: CONFIDENCE.Unavailable, basis: contrast.basis }
      : {
          label: bucket(contrast.value, CONTRAST_BUCKETS),
          confidence: CONFIDENCE.Estimated,
          basis: `thin/thick ratio ${(1 - contrast.value).toFixed(2)}`,
          value: contrast.value,
        }

  // With no measurable modulation the thinnest axis is just noise, so the
  // stress angle is reported as unavailable rather than as a spurious value.
  const hasModulation = contrast.value !== null && contrast.value >= 0.08
  const stressAngle: Metric =
    stress && hasModulation
      ? measured(stress.angle, `thinnest axis of '${ring!.name}'`)
      : stress
        ? unavailable('stroke is monolinear, so stress is undefined')
        : unavailable('no round glyph to measure')

  // ---- Slant -----------------------------------------------------------
  const slantGlyph = firstGlyph(source, ['I', 'l', 'H', 'i'])
  const measuredSlant = slantGlyph ? measureSlant(slantGlyph.outline) : null
  const slant: Metric =
    measuredSlant !== null && Math.abs(measuredSlant) > 0.15
      ? measured(measuredSlant, `stem angle of '${slantGlyph!.name}'`)
      : source.declaredItalicAngle !== 0
        ? declared(-source.declaredItalicAngle, 'post.italicAngle')
        : measured(measuredSlant ?? 0, 'upright stems')

  // ---- Weight ----------------------------------------------------------
  const weightReference = capHeight.value ?? xHeight.value ?? upm * 0.7
  const weightRatio =
    stemWidth !== null && weightReference > 0
      ? stemWidth / weightReference
      : null
  const weight: Classification =
    weightRatio === null
      ? {
          label:
            source.declaredWeightClass === null
              ? 'Unknown'
              : (WEIGHT_CLASS_NAMES[source.declaredWeightClass] ?? 'Custom'),
          confidence:
            source.declaredWeightClass === null
              ? CONFIDENCE.Unavailable
              : CONFIDENCE.Declared,
          basis: 'OS/2 usWeightClass',
        }
      : {
          label: WEIGHT_CLASS_NAMES[bucket(weightRatio, WEIGHT_BUCKETS)],
          confidence: CONFIDENCE.Estimated,
          basis: `stem is ${(weightRatio * 100).toFixed(1)}% of cap height`,
          value: weightRatio,
        }

  // ---- Width -----------------------------------------------------------
  const widthReference = source.byChar('H') ?? source.byChar('n')
  const widthRatio =
    widthReference && !widthReference.isEmpty && weightReference > 0
      ? widthReference.advanceWidth / weightReference
      : null
  const width: Classification =
    widthRatio === null
      ? {
          label: 'Unknown',
          confidence: CONFIDENCE.Unavailable,
          basis: 'no reference glyph',
        }
      : {
          label: bucket(widthRatio, WIDTH_BUCKETS),
          confidence: CONFIDENCE.Estimated,
          basis: `'${widthReference!.name}' advance is ${widthRatio.toFixed(2)}x cap height`,
          value: widthRatio,
        }

  // ---- Serifs ----------------------------------------------------------
  // Sampling several stems matters: many sans faces give their uppercase 'I'
  // crossbars to distinguish it from 'l', which alone reads as a serif.
  const serifRatios: number[] = []
  for (const char of ['H', 'l', 'n', 'I', 'i', 'E']) {
    const glyph = source.byChar(char)
    if (!glyph || glyph.isEmpty) continue
    const ratio = measureSerifRatio(glyph.outline)
    if (ratio !== null && Number.isFinite(ratio)) serifRatios.push(ratio)
  }
  const serifRatio = median(serifRatios)
  const serifs: Classification =
    serifRatio === null
      ? { label: 'Unknown', confidence: CONFIDENCE.Unavailable, basis: 'no stem glyph' }
      : {
          label:
            serifRatio > 1.4 ? 'Serif' : serifRatio > 1.12 ? 'Slab / flared' : 'Sans serif',
          confidence: CONFIDENCE.Estimated,
          basis: `stem foot is ${serifRatio.toFixed(2)}x the stem, over ${serifRatios.length} glyphs`,
          value: serifRatio,
        }

  // ---- Geometry --------------------------------------------------------
  const oAspect = ring ? rectAspect(ring.bounds) : null
  const geometry: Classification = classifyGeometry({
    aspect: oAspect,
    contrast: contrast.value,
    stressAngle: stressAngle.value,
    serif: serifs.label,
  })

  // ---- Corners, terminals, curvature -----------------------------------
  const shapeSample = ['a', 'e', 's', 'c', 'n', 'o', 'r', 't', 'g']
    .map((char) => source.byChar(char))
    .filter((g): g is AnalysisGlyph => g !== null && !g.isEmpty)
    .map((g) => g.outline)

  const cornerStats = measureCorners(shapeSample)
  const corners: Classification =
    cornerStats.cornerNodes === 0
      ? { label: 'Unknown', confidence: CONFIDENCE.Unavailable, basis: 'no sampled glyphs' }
      : {
          label:
            cornerStats.sharpFraction > 0.55
              ? 'Sharp'
              : cornerStats.sharpFraction > 0.28
                ? 'Moderate'
                : 'Soft',
          confidence: CONFIDENCE.Estimated,
          basis: `${(cornerStats.sharpFraction * 100).toFixed(0)}% of ${cornerStats.cornerNodes} corners turn >60°`,
          value: cornerStats.sharpFraction,
        }

  const terminals: Classification = classifyTerminals(cornerStats, serifs.label)

  const curvatureStats = measureCurvature(shapeSample)
  const curvature: Classification =
    curvatureStats.variation === null
      ? { label: 'Unknown', confidence: CONFIDENCE.Unavailable, basis: 'no curves sampled' }
      : {
          label:
            curvatureStats.variation < 0.55
              ? 'Even'
              : curvatureStats.variation < 1.1
                ? 'Modulated'
                : 'Varied',
          confidence: CONFIDENCE.Estimated,
          basis: `curvature varies by ${(curvatureStats.variation * 100).toFixed(0)}% across ${curvatureStats.samples} samples`,
          value: curvatureStats.variation,
        }

  return {
    unitsPerEm: upm,
    xHeight,
    capHeight,
    ascender,
    descender,
    xHeightRatio: ratio(xHeight, 'x-height ÷ upm'),
    capHeightRatio: ratio(capHeight, 'cap height ÷ upm'),
    capOvershoot,
    xOvershoot,
    averageAdvanceWidth,
    averageLeftSideBearing,
    averageRightSideBearing,
    averageGlyphHeight,
    verticalStem,
    horizontalStroke,
    contrast,
    contrastLabel,
    stressAngle,
    slant,
    weight,
    width,
    geometry,
    terminals,
    corners,
    curvature,
    serifs,
    widthDistribution: buildWidthDistribution(advanceWidths),
    sampledGlyphs: spacingSample.length,
    missingKeyGlyphs,
  }
}

function classifyGeometry(input: {
  aspect: number | null
  contrast: number | null
  stressAngle: number | null
  serif: string
}): Classification {
  const { aspect, contrast, stressAngle } = input
  if (aspect === null || contrast === null) {
    return {
      label: 'Unknown',
      confidence: CONFIDENCE.Unavailable,
      basis: 'no round glyph to measure',
    }
  }
  const parts = [`round glyph aspect ${aspect.toFixed(2)}`]
  if (stressAngle !== null) parts.push(`stress ${stressAngle.toFixed(0)}°`)

  let label: string
  if (input.serif === 'Serif' || input.serif === 'Slab / flared') {
    if (contrast < 0.15) label = 'Slab'
    else if (contrast > 0.82) label = 'Didone'
    else if (stressAngle !== null && Math.abs(stressAngle) > 14) label = 'Oldstyle'
    else label = 'Transitional'
  } else if (contrast < 0.1 && aspect > 0.94) {
    label = 'Geometric'
  } else if (stressAngle !== null && Math.abs(stressAngle) > 14) {
    label = 'Humanist'
  } else if (contrast < 0.2) {
    label = 'Grotesque'
  } else {
    label = 'Neo-grotesque'
  }

  return {
    label,
    confidence: CONFIDENCE.Estimated,
    basis: parts.join(', '),
    value: aspect,
  }
}

function classifyTerminals(
  corners: { sharpFraction: number; cornerNodes: number; totalNodes: number },
  serif: string,
): Classification {
  if (corners.totalNodes === 0) {
    return {
      label: 'Unknown',
      confidence: CONFIDENCE.Unavailable,
      basis: 'no sampled glyphs',
    }
  }
  const cornerDensity = corners.cornerNodes / corners.totalNodes
  const label =
    serif === 'Serif'
      ? 'Serifed'
      : corners.sharpFraction > 0.5
        ? 'Flat'
        : cornerDensity < 0.22
          ? 'Rounded'
          : 'Angled'
  return {
    label,
    confidence: CONFIDENCE.Estimated,
    basis: `${(cornerDensity * 100).toFixed(0)}% of nodes are corners`,
    value: cornerDensity,
  }
}

/**
 * Groups advance widths into buckets for the distribution chart.
 *
 * The range is clipped to the 1st-99th percentile: symbol and CJK fonts
 * contain a handful of glyphs many times wider than the rest, and a linear
 * range over the raw extremes collapses every real glyph into one bar.
 */
function buildWidthDistribution(widths: number[]): WidthBucket[] {
  const positive = widths.filter((w) => w > 0).sort((a, b) => a - b)
  if (positive.length === 0) return []

  const at = (fraction: number): number =>
    positive[
      Math.min(positive.length - 1, Math.max(0, Math.round(fraction * (positive.length - 1))))
    ]
  const min = at(0.01)
  const max = at(0.99)
  if (max <= min) return [{ width: min, count: positive.length }]

  const bucketCount = 28
  const size = (max - min) / bucketCount
  const counts = new Array<number>(bucketCount).fill(0)
  for (const value of positive) {
    // Values outside the clipped range fall into the end buckets.
    const index = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((value - min) / size)),
    )
    counts[index] += 1
  }
  return counts.map((count, i) => ({
    width: Math.round(min + size * (i + 0.5)),
    count,
  }))
}

/** Bounds helper for callers that build AnalysisGlyph records themselves. */
export function analysisGlyphFromOutline(
  name: string,
  advanceWidth: number,
  outline: Outline,
): AnalysisGlyph {
  const bounds = outlineBounds(outline)
  return {
    name,
    advanceWidth,
    outline,
    bounds,
    isEmpty: outline.contours.length === 0,
  }
}
