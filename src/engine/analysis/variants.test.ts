import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { CONSTRUCTION } from './glyphStructure'
import { analyzeVariants, findFeatureAlternates, suggestVariants } from './variants'
import { diffHotspots } from './outlineDiff'

const DIR = resolve(__dirname, '../../../test-fonts')
const cache = new Map<string, Promise<ParsedFont>>()

function load(file: string): Promise<ParsedFont> {
  let existing = cache.get(file)
  if (!existing) {
    existing = (async () => {
      const bytes = readFileSync(resolve(DIR, file))
      return parseFontFile({
        name: file,
        buffer: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      })
    })()
    cache.set(file, existing)
  }
  return existing
}

const has = (file: string): boolean => existsSync(resolve(DIR, file))
const describeIf = (file: string) => (has(file) ? describe : describe.skip)

describeIf('SFNS.ttf')('variants from the font’s own features', () => {
  it('finds the one-storey a that SF ships as a character variant', async () => {
    const parsed = await load('SFNS.ttf')
    const a = parsed.cmap.get(0x61)!

    const alternates = findFeatureAlternates(parsed.otFont, a)
    expect(alternates.length).toBeGreaterThan(0)
    // SF exposes it through both cv07 and ss07, and both names are kept.
    expect(alternates.flatMap((x) => x.tags)).toContain('cv07')
    expect(alternates.flatMap((x) => x.tags)).toContain('ss07')

    const variants = suggestVariants(parsed, {}, a)
    expect(variants.length).toBeGreaterThan(0)

    const oneStorey = variants.find(
      (v) => v.structure.construction === CONSTRUCTION.OneStorey,
    )
    expect(oneStorey).toBeDefined()
    expect(oneStorey!.source).toBe('feature')
    expect(oneStorey!.label).toContain('One-storey')
  })

  it('reports the construction change in plain language', async () => {
    const parsed = await load('SFNS.ttf')
    const variants = suggestVariants(parsed, {}, parsed.cmap.get(0x61)!)
    const oneStorey = variants.find(
      (v) => v.structure.construction === CONSTRUCTION.OneStorey,
    )!
    const change = oneStorey.changes.find((c) => c.id === 'construction')
    expect(change?.detail).toBe('Two-storey → One-storey')
  })

  it('offers the tailed l that SF ships', async () => {
    const parsed = await load('SFNS.ttf')
    const variants = suggestVariants(parsed, {}, parsed.cmap.get(0x6c)!)
    expect(variants.length).toBeGreaterThan(0)
    expect(variants.some((v) => v.featureTag === 'cv06')).toBe(true)
  })

  it('never offers the glyph itself as a variant of itself', async () => {
    const parsed = await load('SFNS.ttf')
    const a = parsed.cmap.get(0x61)!
    for (const variant of suggestVariants(parsed, {}, a)) {
      expect(variant.glyphIndex).not.toBe(a)
    }
  })

  it('locates the difference on the letter', async () => {
    const parsed = await load('SFNS.ttf')
    const a = parsed.cmap.get(0x61)!
    const current = resolveGlyph(parsed, {}, a)
    const variants = suggestVariants(parsed, {}, a)
    const oneStorey = variants.find(
      (v) => v.structure.construction === CONSTRUCTION.OneStorey,
    )!

    const spots = diffHotspots(current.outline, oneStorey.outline)
    expect(spots.length).toBeGreaterThan(0)
    // Every hotspot must sit inside the letter, not float off it.
    for (const spot of spots) {
      expect(spot.x).toBeGreaterThanOrEqual(current.bounds.xMin - 100)
      expect(spot.x).toBeLessThanOrEqual(current.bounds.xMax + 100)
      expect(spot.magnitude).toBeGreaterThan(0)
      expect(spot.label.length).toBeGreaterThan(0)
    }
  })
})

describeIf('ArialBlack.ttf')('a font with no alternates', () => {
  it('says so instead of inventing a shape', async () => {
    const parsed = await load('ArialBlack.ttf')
    const report = analyzeVariants(parsed, {}, parsed.cmap.get(0x61)!)
    expect(report.variants).toHaveLength(0)
    expect(report.emptyReason).toBeTruthy()
    expect(report.emptyReason).toMatch(/no alternate|none of them/i)
  })

  it('still reports the structural reading', async () => {
    const parsed = await load('ArialBlack.ttf')
    const report = analyzeVariants(parsed, {}, parsed.cmap.get(0x61)!)
    expect(report.structure.construction).toBe(CONSTRUCTION.TwoStorey)
  })
})

describe('diffHotspots', () => {
  it('finds nothing when the outlines match', async () => {
    if (!has('ArialBlack.ttf')) return
    const parsed = await load('ArialBlack.ttf')
    const glyph = resolveGlyph(parsed, {}, parsed.cmap.get(0x61)!)
    expect(diffHotspots(glyph.outline, glyph.outline)).toHaveLength(0)
  })

  it('returns nothing for an empty outline', () => {
    expect(diffHotspots({ contours: [] }, { contours: [] })).toHaveLength(0)
  })
})

describeIf('SFNS.ttf')('candidates that are not really variants', () => {
  it('rejects the superscript a that ORDN maps to', async () => {
    const parsed = await load('SFNS.ttf')
    const variants = suggestVariants(parsed, {}, parsed.cmap.get(0x61)!)
    // a.sups is a different size for a different job, not another form of a.
    expect(variants.some((v) => v.glyphName.includes('sups'))).toBe(false)
    expect(variants.some((v) => v.featureTag === 'ordn')).toBe(false)
  })

  it('keeps every candidate within the letter’s own proportions', async () => {
    const parsed = await load('SFNS.ttf')
    const a = parsed.cmap.get(0x61)!
    const current = resolveGlyph(parsed, {}, a)
    const height = current.bounds.yMax - current.bounds.yMin
    for (const variant of suggestVariants(parsed, {}, a)) {
      const candidate = resolveGlyph(parsed, {}, variant.glyphIndex)
      const ratio = (candidate.bounds.yMax - candidate.bounds.yMin) / height
      expect(ratio).toBeGreaterThan(0.7)
      expect(ratio).toBeLessThan(1.45)
    }
  })
})

describeIf('SFNS.ttf')('alternates read the same from either side', () => {
  it('offers the way back from an alternate to its default form', async () => {
    const parsed = await load('SFNS.ttf')
    const a = parsed.cmap.get(0x61)!
    const forward = findFeatureAlternates(parsed.otFont, a).find(
      (edge) => parsed.glyphs[edge.target]?.name === 'a.1',
    )!
    expect(forward).toBeDefined()

    // The font declares `a -> a.1` and nothing in the other direction, so
    // reading the substitution one way left the alternate itself with no
    // variants at all: the same font answering the same question about the
    // same pair of glyphs differently depending on which one was selected.
    const back = findFeatureAlternates(parsed.otFont, forward.target)
    expect(back.map((edge) => edge.target)).toContain(a)

    const variants = suggestVariants(parsed, {}, forward.target)
    expect(variants.length).toBeGreaterThan(0)
    expect(variants.map((v) => v.glyphIndex)).toContain(a)
  })

  it('keeps every feature that reaches one drawing', async () => {
    const parsed = await load('SFNS.ttf')
    const edges = findFeatureAlternates(parsed.otFont, parsed.cmap.get(0x61)!)
    const oneStorey = edges.find((edge) =>
      parsed.glyphs[edge.target]?.name === 'a.1',
    )!

    expect(oneStorey.tags).toEqual(['cv07', 'ss07'])
  })

  it('never offers a different letter as a form of this one', async () => {
    const parsed = await load('SFNS.ttf')
    const a = parsed.cmap.get(0x61)!
    const A = parsed.cmap.get(0x41)!

    // SF maps `a -> A.sc` under smcp and `A -> A.sc` under c2sc. Walking the
    // graph forwards and then backwards steps from the lowercase a through
    // the small cap and out into the capital, which is a different letter.
    const targets = findFeatureAlternates(parsed.otFont, a).map((e) => e.target)
    expect(targets).not.toContain(A)

    expect(suggestVariants(parsed, {}, a).map((v) => v.glyphIndex)).not.toContain(A)
  })

  it('names the direction of the substitution', async () => {
    const parsed = await load('SFNS.ttf')
    const a = parsed.cmap.get(0x61)!
    const edge = findFeatureAlternates(parsed.otFont, a).find(
      (candidate) => parsed.glyphs[candidate.target]?.name === 'a.1',
    )!

    expect(edge.forward).toBe(true)
    const back = findFeatureAlternates(parsed.otFont, edge.target).find(
      (candidate) => candidate.target === a,
    )!
    expect(back.forward).toBe(false)
  })

  it('offers figures their own alternate forms', async () => {
    const parsed = await load('SFNS.ttf')
    const one = parsed.cmap.get(0x31)!

    // A digit has as many forms as a letter: SF ships an alternate one and a
    // tabular one, and neither used to be offered at all.
    const labels = suggestVariants(parsed, {}, one).map((v) => v.label)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.join(' ')).not.toContain('Unknown feature')
  })
})

describeIf('dev-OpenSans-Regular.ttf')('a font that has alternates, just not here', () => {
  it('says the font has alternates rather than implying it has none', async () => {
    const parsed = await load('dev-OpenSans-Regular.ttf')
    const report = analyzeVariants(parsed, {}, parsed.cmap.get(0x61)!)

    // Open Sans ships stylistic sets covering `g`, `I` and the figures, and
    // nothing at all for `a`. Reporting that as though the font had no
    // alternates is the difference between "there is no other a" and "this
    // font is hiding one", and only one of those is true.
    expect(report.variants).toHaveLength(0)
    expect(report.alternatesElsewhere.count).toBeGreaterThan(50)
    expect(report.alternatesElsewhere.examples).toContain('g')
    expect(report.emptyReason).toContain('but none for this one')
  })

  it('names the candidate it turned down, and why', async () => {
    const parsed = await load('dev-OpenSans-Regular.ttf')
    const report = analyzeVariants(parsed, {}, parsed.cmap.get(0x61)!)

    // `aalt` lists `a -> ordfeminine`. The feminine ordinal is a different
    // character, not another drawing of a, and at 61% of the height it is
    // caught by the proportion check -- but silently dropping it looks
    // identical to finding nothing.
    const ordinal = report.rejected.find((r) => r.glyphName === 'ordfeminine')
    expect(ordinal).toBeDefined()
    expect(ordinal!.reason).toContain('different character')
  })

  it('still finds the alternates the font really does ship', async () => {
    const parsed = await load('dev-OpenSans-Regular.ttf')

    // The single-storey g is a real stylistic alternate, under four tags.
    const g = suggestVariants(parsed, {}, parsed.cmap.get(0x67)!)
    expect(g.map((v) => v.label)).toContain('Single-storey g')

    // Figures get their oldstyle and lining forms.
    const one = suggestVariants(parsed, {}, parsed.cmap.get(0x31)!)
    expect(one.length).toBeGreaterThan(0)
  })

  it('distinguishes a font with no alternates at all', async () => {
    const arial = await load('ArialBlack.ttf')
    const report = analyzeVariants(arial, {}, arial.cmap.get(0x61)!)

    expect(report.alternatesElsewhere.count).toBe(0)
    expect(report.emptyReason).toContain('no alternate letterforms at all')
  })
})
