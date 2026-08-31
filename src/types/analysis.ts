/**
 * Font DNA types.
 *
 * Every derived number carries how it was obtained so the UI can be honest
 * about which values are read from the font's own tables and which are
 * heuristics measured off the outlines.
 */

export const CONFIDENCE = {
  /** Measured directly from glyph geometry. */
  Measured: 'measured',
  /** Read from a font table (OS/2, post, hhea). */
  Declared: 'declared',
  /** A heuristic classification derived from measurements. */
  Estimated: 'estimated',
  /** The font does not contain what is needed. */
  Unavailable: 'unavailable',
} as const
export type Confidence = (typeof CONFIDENCE)[keyof typeof CONFIDENCE]

export interface Metric {
  value: number | null
  confidence: Confidence
  /** Short human explanation, e.g. "measured from 'x'". */
  basis: string
}

export interface Classification {
  label: string
  confidence: Confidence
  basis: string
  /** Supporting number, when there is one. */
  value?: number
}

export interface WidthBucket {
  width: number
  count: number
}

export interface StemMeasurement {
  /** Median stem width in font units. */
  width: Metric
  /** Individual samples, for display and QA cross-checks. */
  samples: Array<{ glyph: string; width: number }>
}

export interface FontDna {
  unitsPerEm: number

  xHeight: Metric
  capHeight: Metric
  ascender: Metric
  descender: Metric
  /** x-height as a fraction of the em. */
  xHeightRatio: Metric
  capHeightRatio: Metric

  /** Round-glyph overshoot above cap height and x-height. */
  capOvershoot: Metric
  xOvershoot: Metric

  averageAdvanceWidth: Metric
  averageLeftSideBearing: Metric
  averageRightSideBearing: Metric
  averageGlyphHeight: Metric

  verticalStem: StemMeasurement
  horizontalStroke: Metric

  contrast: Metric
  contrastLabel: Classification
  /** Angle of the thinnest part of 'O', 0deg = vertical stress. */
  stressAngle: Metric

  slant: Metric
  weight: Classification
  width: Classification
  geometry: Classification
  terminals: Classification
  corners: Classification
  curvature: Classification
  serifs: Classification

  widthDistribution: WidthBucket[]
  /** Glyphs actually available for measurement. */
  sampledGlyphs: number
  missingKeyGlyphs: string[]
}
