/**
 * Structural analysis of a single glyph.
 *
 * This answers the questions a type designer asks when looking at a letter:
 * how many counters does it enclose, is it built in one storey or two, does
 * it carry a tail, where is the junction and how thin does it get there.
 *
 * Everything here is measured from the outline. Where a reading is a
 * judgement rather than a measurement it is reported as an estimate, because
 * the difference matters when the answer drives a suggested edit.
 */
import type { Outline, Rect } from '@/types/geometry'
import { contourIsOuter } from '@/engine/geometry/nesting'
import { contourSignedArea, outlineBounds } from '@/engine/geometry/outline'
import { inkRunsAtY } from '@/engine/geometry/intersect'

export type Certainty = 'measured' | 'estimated'

export interface CounterInfo {
  bounds: Rect
  area: number
  /** Where the counter sits within the glyph's own height. */
  band: 'upper' | 'middle' | 'lower'
}

export interface StructuralNote {
  id: string
  label: string
  value: string
  certainty: Certainty
  /** Where on the glyph this reading came from, for the annotated diagram. */
  at?: { x: number; y: number }
}

export const CONSTRUCTION = {
  TwoStorey: 'two-storey',
  OneStorey: 'one-storey',
  /** Two bowls, the lower one closed: Georgia, Times, Palatino. */
  DoubleStorey: 'double-storey',
  /** An upper bowl over an open descending tail: Baskerville, Trebuchet. */
  DoubleStoreyOpen: 'double-storey-open',
  SingleStorey: 'single-storey',
  Unknown: 'unknown',
} as const
export type Construction =
  (typeof CONSTRUCTION)[keyof typeof CONSTRUCTION]

export interface GlyphStructure {
  contourCount: number
  counters: CounterInfo[]
  /** Construction, when the character has a recognised pair of forms. */
  construction: Construction
  constructionCertainty: Certainty
  /** A stroke that leaves the main shape at the lower right, as on a or l. */
  tail: TailInfo | null
  /** The narrowest horizontal ink in the middle band -- the junction. */
  junction: { thickness: number; x: number; y: number } | null
  notes: StructuralNote[]
}

export interface TailInfo {
  /** Ink to the right of the main stem in the bottom band. */
  bounds: Rect
  /** How far it reaches beyond the stem, in font units. */
  reach: number
  /** Vertical extent of the tail. */
  height: number
}

function bandOf(bounds: Rect, glyphBounds: Rect): CounterInfo['band'] {
  const height = glyphBounds.yMax - glyphBounds.yMin
  if (height <= 0) return 'middle'
  const centre = (bounds.yMin + bounds.yMax) / 2
  const relative = (centre - glyphBounds.yMin) / height
  if (relative >= 0.58) return 'upper'
  if (relative <= 0.42) return 'lower'
  return 'middle'
}

/**
 * Counters are the enclosed white shapes: contours nested inside another.
 * Very small ones are ignored, since a stray two-unit loop from a bad
 * conversion is not something a designer would call a counter.
 */
function findCounters(outline: Outline, glyphBounds: Rect): CounterInfo[] {
  const outer = contourIsOuter(outline)
  const glyphArea = Math.max(
    1,
    (glyphBounds.xMax - glyphBounds.xMin) * (glyphBounds.yMax - glyphBounds.yMin),
  )

  const counters: CounterInfo[] = []
  outline.contours.forEach((contour, index) => {
    if (outer[index]) return
    if (contour.nodes.length < 2) return
    const bounds = outlineBounds({ contours: [contour] })
    const area = Math.abs(contourSignedArea(contour))
    if (area / glyphArea < 0.004) return
    counters.push({ bounds, area, band: bandOf(bounds, glyphBounds) })
  })
  return counters.sort((a, b) => b.area - a.area)
}

/**
 * Finds the narrowest ink in the middle of the glyph.
 *
 * On a two-storey `a` this lands on the join between the bowl and the arch,
 * which is the spot the reference diagrams label "thinner": it is where the
 * letter is most fragile and the first thing to check when changing weight.
 */
function findJunction(
  outline: Outline,
  bounds: Rect,
): { thickness: number; x: number; y: number } | null {
  const height = bounds.yMax - bounds.yMin
  if (height <= 0) return null

  let best: { thickness: number; x: number; y: number } | null = null
  const samples = 40
  for (let i = 0; i <= samples; i += 1) {
    // Only the middle band; the top and bottom are terminals, not junctions.
    const y = bounds.yMin + height * (0.3 + (0.45 * i) / samples)
    const runs = inkRunsAtY(outline, y)
    if (runs.length < 2) continue
    // With two or more runs the glyph is split here; the thinnest run is
    // the candidate junction.
    for (const run of runs) {
      const thickness = run.end - run.start
      if (thickness <= 0) continue
      if (best === null || thickness < best.thickness) {
        // Record where it is, not just how thin: the callout has to land
        // on the join rather than in the middle of the letter.
        best = { thickness, x: (run.start + run.end) / 2, y }
      }
    }
  }
  return best
}

/**
 * Detects a tail: ink in the bottom band that sits to the right of
 * everything above it.
 *
 * A two-storey `a` with a tail has a short stroke flicking out at the
 * baseline past the stem. Comparing the rightmost ink low down with the
 * rightmost ink higher up isolates exactly that.
 */
function findTail(outline: Outline, bounds: Rect): TailInfo | null {
  const height = bounds.yMax - bounds.yMin
  if (height <= 0) return null

  const rightAt = (y: number): number | null => {
    const runs = inkRunsAtY(outline, y)
    if (runs.length === 0) return null
    return Math.max(...runs.map((run) => run.end))
  }

  // The stem's right edge, read from the settled middle of the glyph.
  const middleSamples: number[] = []
  for (let i = 0; i <= 8; i += 1) {
    const value = rightAt(bounds.yMin + height * (0.35 + 0.3 * (i / 8)))
    if (value !== null) middleSamples.push(value)
  }
  if (middleSamples.length === 0) return null
  const stemRight = Math.min(...middleSamples)

  let reach = 0
  let tailBottom = Infinity
  let tailTop = -Infinity
  for (let i = 0; i <= 16; i += 1) {
    const y = bounds.yMin + height * (0.02 + 0.26 * (i / 16))
    const value = rightAt(y)
    if (value === null) continue
    const beyond = value - stemRight
    if (beyond > reach) reach = beyond
    if (beyond > height * 0.02) {
      tailBottom = Math.min(tailBottom, y)
      tailTop = Math.max(tailTop, y)
    }
  }

  // Too small to be a tail rather than a rounding artefact.
  if (reach < height * 0.04 || !Number.isFinite(tailBottom)) return null

  return {
    bounds: {
      xMin: stemRight,
      xMax: stemRight + reach,
      yMin: tailBottom,
      yMax: tailTop,
    },
    reach,
    height: tailTop - tailBottom,
  }
}

/**
 * How a character's two well-known constructions are told apart.
 *
 * The rules below come from measuring real faces rather than from intuition.
 * A one-storey `a` is a bowl with a stem, so its counter is shaped like the
 * one in `o`: tall and vertically centred. A two-storey `a` has either a
 * small counter sitting low (Arial, Times) or no closed counter at all, when
 * the aperture is open (SF). A double-storey `g` genuinely encloses two
 * counters, one above the other, where a single-storey `g` encloses one.
 */
interface ConstructionRule {
  decide: (counters: CounterInfo[], bounds: Rect) => Construction
}

const CONSTRUCTION_RULES: Record<string, ConstructionRule> = {
  a: {
    decide: (counters, bounds) => {
      const height = bounds.yMax - bounds.yMin
      if (height <= 0) return CONSTRUCTION.Unknown
      const bowlLike = counters.some((counter) => {
        const counterHeight = counter.bounds.yMax - counter.bounds.yMin
        const centre =
          ((counter.bounds.yMin + counter.bounds.yMax) / 2 - bounds.yMin) / height
        return counterHeight / height >= 0.55 && centre > 0.4 && centre < 0.62
      })
      return bowlLike ? CONSTRUCTION.OneStorey : CONSTRUCTION.TwoStorey
    },
  },
  g: {
    decide: (counters, bounds) => {
      if (counters.length >= 2) return CONSTRUCTION.DoubleStorey

      const height = bounds.yMax - bounds.yMin
      const width = bounds.xMax - bounds.xMin
      const counter = counters[0]
      if (!counter || height <= 0 || width <= 0) return CONSTRUCTION.SingleStorey

      // With one closed counter the question is what that counter is. A
      // small one sitting high is the upper bowl of a double-storey g whose
      // lower loop was left open; a large one filling the width is the
      // single bowl of a one-storey g. Measured across Baskerville and
      // Trebuchet (upper bowls, 0.41-0.49 wide at 0.71-0.77 high) against
      // Futura, Verdana and Courier (single bowls, 0.55-0.67 at 0.64-0.66).
      const centre =
        ((counter.bounds.yMin + counter.bounds.yMax) / 2 - bounds.yMin) / height
      const relativeWidth = (counter.bounds.xMax - counter.bounds.xMin) / width

      return centre > 0.685 && relativeWidth < 0.53
        ? CONSTRUCTION.DoubleStoreyOpen
        : CONSTRUCTION.SingleStorey
    },
  },
}

export function analyzeGlyphStructure(
  outline: Outline,
  options: { char?: string | null } = {},
): GlyphStructure {
  const bounds = outlineBounds(outline)
  const counters = findCounters(outline, bounds)
  const junction = findJunction(outline, bounds)
  const tail = findTail(outline, bounds)

  let construction: Construction = CONSTRUCTION.Unknown
  const constructionCertainty: Certainty = 'measured'
  const rule = options.char ? CONSTRUCTION_RULES[options.char] : undefined
  if (rule) construction = rule.decide(counters, bounds)

  const notes: StructuralNote[] = []
  notes.push({
    id: 'contours',
    label: 'Contours',
    value: String(outline.contours.length),
    certainty: 'measured',
  })
  notes.push({
    id: 'counters',
    label: 'Counters',
    value:
      counters.length === 0
        ? 'None'
        : counters
            .map((counter) => counter.band)
            .join(', '),
    certainty: 'measured',
  })
  if (construction !== CONSTRUCTION.Unknown) {
    notes.push({
      id: 'construction',
      label: 'Construction',
      value: constructionLabel(construction),
      certainty: constructionCertainty,
    })
  }
  if (junction) {
    notes.push({
      id: 'junction',
      label: 'Thinnest join',
      value: `${Math.round(junction.thickness)} units`,
      certainty: 'measured',
      at: { x: junction.x, y: junction.y },
    })
  }
  if (tail) {
    notes.push({
      id: 'tail',
      label: 'Tail',
      value: `reaches ${Math.round(tail.reach)} units`,
      certainty: 'estimated',
      at: { x: tail.bounds.xMax, y: (tail.bounds.yMin + tail.bounds.yMax) / 2 },
    })
  }

  return {
    contourCount: outline.contours.length,
    counters,
    construction,
    constructionCertainty,
    tail,
    junction,
    notes,
  }
}

export function constructionLabel(construction: Construction): string {
  switch (construction) {
    case CONSTRUCTION.TwoStorey:
      return 'Two-storey'
    case CONSTRUCTION.OneStorey:
      return 'One-storey'
    case CONSTRUCTION.DoubleStorey:
      return 'Double-storey'
    case CONSTRUCTION.DoubleStoreyOpen:
      return 'Double-storey, open tail'
    case CONSTRUCTION.SingleStorey:
      return 'Single-storey'
    default:
      return 'Unclassified'
  }
}
