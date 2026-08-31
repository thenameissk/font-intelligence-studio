/**
 * The style-matching engine.
 *
 * Given a reading of the glyph being edited and a reading of a reference,
 * it works out which of the transformations this application can actually
 * perform would close the gap, and by how much. Each proposal carries the
 * arithmetic that produced it, so a designer can see why it is suggesting
 * a 24-unit offset rather than being asked to trust it.
 *
 * Two rules shape the output:
 *
 *   - The advance width is never touched. The reference supplies style; the
 *     font keeps its own rhythm and fit. Width changes scale the drawing
 *     inside the existing advance rather than changing the spacing.
 *   - Only measurable attributes are proposed. Weight, slant, width and
 *     corner character are all things a transformation can move precisely.
 *     The shape of a letter is not, so nothing here pretends to redraw one.
 */
import type { StyleProfile } from '@/engine/analysis/styleProfile'
import type { TransformSpec } from './applySpec'

export const MATCH_CONFIDENCE = {
  /** Computed directly from two measurements of the same quantity. */
  Measured: 'measured',
  /** Derived from a proxy, so the magnitude is approximate. */
  Estimated: 'estimated',
} as const
export type MatchConfidence =
  (typeof MATCH_CONFIDENCE)[keyof typeof MATCH_CONFIDENCE]

export interface StyleProposal {
  id: string
  label: string
  /** Why this is proposed, including the numbers behind it. */
  rationale: string
  spec: TransformSpec
  confidence: MatchConfidence
  /** Larger means this closes more of the visible gap. */
  weight: number
}

export interface MatchOptions {
  /** Height of the glyph being edited, in font units. */
  glyphHeight: number
  /** Ignore differences smaller than this share of the measurement. */
  deadZone?: number
  /** Cap on how far weight may move, as a share of glyph height. */
  maxWeightShift?: number
}

/**
 * Proposals that would bring `current` towards `reference`.
 *
 * Returned strongest first. Nothing is applied: the caller previews the set,
 * drops what it does not want, and commits the rest as one undoable step.
 */
export function proposeStyleMatch(
  current: StyleProfile,
  reference: StyleProfile,
  options: MatchOptions,
): StyleProposal[] {
  const { glyphHeight } = options
  const deadZone = options.deadZone ?? 0.04
  const maxWeightShift = options.maxWeightShift ?? 0.08
  const proposals: StyleProposal[] = []

  if (glyphHeight <= 0) return proposals

  // ---- Weight ----------------------------------------------------------
  // Both stem readings are a share of height, so the difference converts to
  // font units directly, and offsetting moves each edge by half of it.
  if (current.stemRatio !== null && reference.stemRatio !== null) {
    const currentStem = current.stemRatio * glyphHeight
    const targetStem = reference.stemRatio * glyphHeight
    const delta = targetStem - currentStem
    const relative = Math.abs(delta) / Math.max(1, currentStem)

    if (relative > deadZone) {
      const capped = Math.max(
        -maxWeightShift * glyphHeight,
        Math.min(maxWeightShift * glyphHeight, delta),
      )
      proposals.push({
        id: 'weight',
        label: capped > 0 ? 'Add weight' : 'Reduce weight',
        rationale:
          `Stems measure ${Math.round(currentStem)} units against the reference’s ` +
          `${Math.round(targetStem)}. Offsetting each edge by ${(capped / 2).toFixed(1)} ` +
          `units closes that.` +
          (Math.abs(capped - delta) > 0.5
            ? ' Capped to keep the change reversible.'
            : ''),
        spec: { kind: 'offset', distance: capped / 2 },
        confidence: MATCH_CONFIDENCE.Measured,
        weight: relative * 3,
      })
    }
  }

  // ---- Slant -----------------------------------------------------------
  if (current.slant !== null && reference.slant !== null) {
    const delta = reference.slant - current.slant
    if (Math.abs(delta) > 1) {
      proposals.push({
        id: 'slant',
        label: delta > 0 ? 'Slant forward' : 'Slant back',
        rationale:
          `The reference leans ${reference.slant.toFixed(1)}° against this glyph’s ` +
          `${current.slant.toFixed(1)}°. Shearing by ${delta.toFixed(1)}° matches it.`,
        spec: { kind: 'slant', degrees: delta },
        confidence: MATCH_CONFIDENCE.Measured,
        weight: Math.min(3, Math.abs(delta) / 4),
      })
    }
  }

  // ---- Width -----------------------------------------------------------
  // Scaling horizontally inside the existing advance: the letter changes
  // proportion, the spacing does not.
  if (current.widthRatio > 0 && reference.widthRatio > 0) {
    const factor = reference.widthRatio / current.widthRatio
    if (Math.abs(factor - 1) > deadZone) {
      const clamped = Math.max(0.75, Math.min(1.33, factor))
      proposals.push({
        id: 'width',
        label: clamped > 1 ? 'Widen' : 'Narrow',
        rationale:
          `The reference is ${reference.widthRatio.toFixed(2)} wide for its height, ` +
          `this glyph ${current.widthRatio.toFixed(2)}. Scaling horizontally by ` +
          `${(clamped * 100).toFixed(0)}% matches the proportion. The advance width ` +
          `is left alone, so spacing is unchanged.`,
        spec: {
          kind: 'scale',
          sx: clamped,
          sy: 1,
          origin: 'center',
          scaleAdvance: false,
        },
        confidence: MATCH_CONFIDENCE.Measured,
        weight: Math.abs(clamped - 1) * 6,
      })
    }
  }

  // ---- Corner character ------------------------------------------------
  // A proxy rather than a measurement: corner counts say how many corners
  // are sharp, not what radius would soften them, so the magnitude is an
  // estimate and is kept deliberately gentle.
  // Both readings need enough corners behind them to mean anything. A
  // traced outline and a drawn one distribute nodes differently, so a share
  // taken from one or two corners compares nothing at all.
  const MIN_CORNER_SAMPLES = 4
  if (
    current.cornerSharpness !== null &&
    reference.cornerSharpness !== null &&
    current.cornerSamples >= MIN_CORNER_SAMPLES &&
    reference.cornerSamples >= MIN_CORNER_SAMPLES &&
    current.cornerSharpness - reference.cornerSharpness > 0.25
  ) {
    const radius = glyphHeight * 0.04
    proposals.push({
      id: 'corners',
      label: 'Soften corners',
      rationale:
        `${Math.round(current.cornerSharpness * 100)}% of this glyph’s corners are sharp ` +
        `against ${Math.round(reference.cornerSharpness * 100)}% in the reference. ` +
        `A ${Math.round(radius)}-unit fillet moves it that way, though the radius is ` +
        `an estimate rather than a measurement.`,
      spec: { kind: 'roundCorners', radius, minAngle: 35 },
      confidence: MATCH_CONFIDENCE.Estimated,
      weight: (current.cornerSharpness - reference.cornerSharpness) * 2,
    })
  }

  return proposals.sort((a, b) => b.weight - a.weight)
}

/** What the engine cannot do, stated rather than silently skipped. */
export function matchLimitations(
  current: StyleProfile,
  reference: StyleProfile,
): string[] {
  const notes: string[] = []

  if (current.stemRatio === null || reference.stemRatio === null) {
    notes.push(
      'Stem weight could not be measured on one of the two shapes, so no weight change is proposed.',
    )
  }
  if (
    Math.min(current.cornerSamples, reference.cornerSamples) < 4 &&
    current.cornerSharpness !== reference.cornerSharpness
  ) {
    notes.push(
      'Corner character was not compared: one of the two shapes has too few corners for the reading to mean anything. A traced outline places nodes differently from a drawn one.',
    )
  }
  if (
    current.contrast !== null &&
    reference.contrast !== null &&
    Math.abs(current.contrast - reference.contrast) > 0.15
  ) {
    notes.push(
      'The reference has a different thick-to-thin relationship. Matching contrast means redrawing the curves, which no transformation can do.',
    )
  }
  notes.push(
    'Style matching adjusts weight, slant, proportion and corner character. It cannot change the letter’s construction — that is a redraw, not a transformation.',
  )
  return notes
}
