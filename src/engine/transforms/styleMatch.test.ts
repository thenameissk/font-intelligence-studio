import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline, outlineBounds } from '@/engine/geometry/outline'
import { profileOutline } from '@/engine/analysis/styleProfile'
import { applyTransformSpec } from './applySpec'
import { matchLimitations, proposeStyleMatch } from './styleMatch'
import type { ResolvedGlyph } from '@/types/font'

/**
 * An H: two stems inside a fixed outer width, plus a crossbar.
 *
 * Unlike a plain bar, its stem weight and its overall proportion move
 * independently, which is what makes it a fair fixture for testing that the
 * engine tells the two apart.
 */
function aitch(stem: number, height: number, width = 500): PathCommand[] {
  const crossbar = height * 0.16
  const y0 = (height - crossbar) / 2
  const y1 = (height + crossbar) / 2
  const rect = (x0: number, ya: number, x1: number, yb: number): PathCommand[] => [
    { type: 'M', x: x0, y: ya },
    { type: 'L', x: x1, y: ya },
    { type: 'L', x: x1, y: yb },
    { type: 'L', x: x0, y: yb },
    { type: 'Z' },
  ]
  return [
    ...rect(0, 0, stem, height),
    ...rect(width - stem, 0, width, height),
    ...rect(stem, y0, width - stem, y1),
  ]
}

/** A vertical bar of a given stem width and height. */
function bar(width: number, height: number, slantDegrees = 0): PathCommand[] {
  const shift = Math.tan((slantDegrees * Math.PI) / 180) * height
  return [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: width, y: 0 },
    { type: 'L', x: width + shift, y: height },
    { type: 'L', x: shift, y: height },
    { type: 'Z' },
  ]
}

function glyphOf(commands: PathCommand[], advanceWidth = 600): ResolvedGlyph {
  const outline = commandsToOutline(commands)
  const bounds = outlineBounds(outline)
  return {
    index: 0,
    name: 'test',
    unicode: null,
    unicodes: [],
    advanceWidth,
    outline,
    components: [],
    bounds,
    leftSideBearing: bounds.xMin,
    rightSideBearing: advanceWidth - bounds.xMax,
    isComposite: false,
    isEmpty: false,
    modified: false,
  }
}

describe('proposeStyleMatch', () => {
  it('proposes nothing when the two readings already agree', () => {
    const profile = profileOutline(commandsToOutline(bar(100, 700)))
    expect(proposeStyleMatch(profile, profile, { glyphHeight: 700 })).toHaveLength(0)
  })

  it('computes the exact offset for a modest weight difference', () => {
    // 80 to 110 is 30 units of stem, well inside the safety cap. The outer
    // width is identical, so only weight should be proposed.
    const current = profileOutline(commandsToOutline(aitch(80, 700)))
    const reference = profileOutline(commandsToOutline(aitch(110, 700)))

    const proposals = proposeStyleMatch(current, reference, { glyphHeight: 700 })
    const proposal = proposals[0]
    expect(proposal.id).toBe('weight')
    expect(proposals.some((p) => p.id === 'width')).toBe(false)
    expect(proposal.confidence).toBe('measured')
    // Each edge moves out by half the difference.
    expect(proposal.spec).toMatchObject({ kind: 'offset' })
    if (proposal.spec.kind === 'offset') {
      expect(proposal.spec.distance).toBeCloseTo(15, 0)
    }
    expect(proposal.rationale).not.toMatch(/Capped/)
  })

  it('caps a weight difference that would be a redraw, and says so', () => {
    // Doubling a stem is Thin to Black in one step; offsetting that far
    // would collapse the counters.
    const current = profileOutline(commandsToOutline(aitch(80, 700)))
    const reference = profileOutline(commandsToOutline(aitch(160, 700)))

    const [proposal] = proposeStyleMatch(current, reference, { glyphHeight: 700 })
    if (proposal.spec.kind === 'offset') {
      // Half of the 8% default cap on a 700-unit glyph.
      expect(proposal.spec.distance).toBeCloseTo(28, 0)
    }
    expect(proposal.rationale).toMatch(/Capped/)
  })

  it('actually closes the weight gap when applied', () => {
    const currentGlyph = glyphOf(aitch(80, 700))
    const reference = profileOutline(commandsToOutline(aitch(150, 700)))
    const current = profileOutline(currentGlyph.outline)

    const [proposal] = proposeStyleMatch(current, reference, { glyphHeight: 700 })
    const changes = applyTransformSpec([currentGlyph], proposal.spec)
    const result = changes[0].outline!

    const after = profileOutline(result)
    // Started 0.114 of height, target 0.214; must land much closer.
    const before = Math.abs(current.stemRatio! - reference.stemRatio!)
    const now = Math.abs(after.stemRatio! - reference.stemRatio!)
    expect(now).toBeLessThan(before * 0.35)
  })

  it('proposes a shear when the reference leans', () => {
    const current = profileOutline(commandsToOutline(bar(100, 700, 0)))
    const reference = profileOutline(commandsToOutline(bar(100, 700, 12)))

    const slant = proposeStyleMatch(current, reference, { glyphHeight: 700 }).find(
      (p) => p.id === 'slant',
    )
    expect(slant).toBeDefined()
    if (slant?.spec.kind === 'slant') {
      expect(slant.spec.degrees).toBeGreaterThan(8)
      expect(slant.spec.degrees).toBeLessThan(16)
    }
  })

  it('never proposes changing the advance width', () => {
    const current = profileOutline(commandsToOutline(bar(80, 700)))
    const reference = profileOutline(commandsToOutline(bar(200, 400)))

    for (const proposal of proposeStyleMatch(current, reference, {
      glyphHeight: 700,
    })) {
      if (proposal.spec.kind === 'scale') {
        expect(proposal.spec.scaleAdvance).toBe(false)
      }
      expect(proposal.spec.kind).not.toBe('spacing')
    }
  })

  it('leaves the advance untouched when a width proposal is applied', () => {
    const glyph = glyphOf(bar(100, 700), 640)
    const current = profileOutline(glyph.outline)
    const reference = profileOutline(commandsToOutline(bar(220, 700)))

    const width = proposeStyleMatch(current, reference, { glyphHeight: 700 }).find(
      (p) => p.id === 'width',
    )
    expect(width).toBeDefined()
    const changes = applyTransformSpec([glyph], width!.spec)
    expect(changes[0].advanceWidth ?? glyph.advanceWidth).toBe(640)
  })

  it('caps a runaway weight change', () => {
    const current = profileOutline(commandsToOutline(bar(20, 700)))
    const reference = profileOutline(commandsToOutline(bar(500, 700)))

    const weight = proposeStyleMatch(current, reference, {
      glyphHeight: 700,
      maxWeightShift: 0.05,
    }).find((p) => p.id === 'weight')

    if (weight?.spec.kind === 'offset') {
      // Half of 5% of 700 units.
      expect(Math.abs(weight.spec.distance)).toBeLessThanOrEqual(17.5 + 0.01)
    }
    expect(weight?.rationale).toMatch(/Capped/)
  })

  it('ranks the biggest difference first', () => {
    const current = profileOutline(commandsToOutline(aitch(80, 700)))
    const reference = profileOutline(commandsToOutline(aitch(190, 700)))
    const proposals = proposeStyleMatch(current, reference, { glyphHeight: 700 })
    expect(proposals[0].id).toBe('weight')
  })

  it('shows its working in the rationale', () => {
    const current = profileOutline(commandsToOutline(aitch(80, 700)))
    const reference = profileOutline(commandsToOutline(aitch(160, 700)))
    const [proposal] = proposeStyleMatch(current, reference, { glyphHeight: 700 })
    expect(proposal.rationale).toMatch(/\d+ units/)
  })
})

describe('matchLimitations', () => {
  it('always says construction cannot be transformed', () => {
    const profile = profileOutline(commandsToOutline(bar(100, 700)))
    expect(matchLimitations(profile, profile).join(' ')).toMatch(/redraw/i)
  })

  it('flags a contrast difference it cannot fix', () => {
    const base = profileOutline(commandsToOutline(bar(100, 700)))
    const monoline = { ...base, contrast: 0.05 }
    const highContrast = { ...base, contrast: 0.8 }
    expect(matchLimitations(monoline, highContrast).join(' ')).toMatch(
      /thick-to-thin/i,
    )
  })

  it('stays quiet about contrast when the two agree', () => {
    const base = profileOutline(commandsToOutline(bar(100, 700)))
    const a = { ...base, contrast: 0.1 }
    const b = { ...base, contrast: 0.12 }
    expect(matchLimitations(a, b).join(' ')).not.toMatch(/thick-to-thin/i)
  })
})

describe('corner proposals', () => {
  const base = profileOutline(commandsToOutline(aitch(100, 700)))

  it('is skipped when either shape has too few corners to judge', () => {
    const sharp = { ...base, cornerSharpness: 1, cornerSamples: 2 }
    const round = { ...base, cornerSharpness: 0, cornerSamples: 20 }
    const proposals = proposeStyleMatch(sharp, round, { glyphHeight: 700 })
    expect(proposals.some((p) => p.id === 'corners')).toBe(false)
  })

  it('says why it skipped the comparison', () => {
    const sharp = { ...base, cornerSharpness: 1, cornerSamples: 2 }
    const round = { ...base, cornerSharpness: 0, cornerSamples: 20 }
    expect(matchLimitations(sharp, round).join(' ')).toMatch(/too few corners/i)
  })

  it('proposes softening when both readings are well founded', () => {
    const sharp = { ...base, cornerSharpness: 0.9, cornerSamples: 12 }
    const round = { ...base, cornerSharpness: 0.1, cornerSamples: 14 }
    const proposal = proposeStyleMatch(sharp, round, { glyphHeight: 700 }).find(
      (p) => p.id === 'corners',
    )
    expect(proposal).toBeDefined()
    // Never presented as a measurement, because it is not one.
    expect(proposal!.confidence).toBe('estimated')
  })

  it('ignores a small corner difference', () => {
    const a = { ...base, cornerSharpness: 0.6, cornerSamples: 12 }
    const b = { ...base, cornerSharpness: 0.45, cornerSamples: 12 }
    expect(
      proposeStyleMatch(a, b, { glyphHeight: 700 }).some((p) => p.id === 'corners'),
    ).toBe(false)
  })
})
