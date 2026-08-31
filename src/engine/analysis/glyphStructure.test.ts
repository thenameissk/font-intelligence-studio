import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { analyzeGlyphStructure, CONSTRUCTION } from './glyphStructure'

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

async function structureOf(file: string, char: string) {
  const parsed = await load(file)
  const index = parsed.cmap.get(char.codePointAt(0)!)
  if (index === undefined) return null
  const glyph = resolveGlyph(parsed, {}, index)
  return analyzeGlyphStructure(glyph.outline, { char })
}

const describeIf = (file: string) => (has(file) ? describe : describe.skip)

describeIf('ArialBlack.ttf')('construction of a two-storey face', () => {
  it('reads Arial Black a as two-storey', async () => {
    const structure = await structureOf('ArialBlack.ttf', 'a')
    expect(structure?.construction).toBe(CONSTRUCTION.TwoStorey)
    expect(structure?.constructionCertainty).toBe('measured')
    // Its one counter is the bowl, and it sits low.
    expect(structure!.counters).toHaveLength(1)
    expect(structure!.counters[0].band).toBe('lower')
  })

  it('reads Arial Black g as single-storey', async () => {
    // Arial's g is a bowl with an open descending hook, not a double-storey g.
    const structure = await structureOf('ArialBlack.ttf', 'g')
    expect(structure?.construction).toBe(CONSTRUCTION.SingleStorey)
  })

  it('finds one counter in o and none in l', async () => {
    const o = await structureOf('ArialBlack.ttf', 'o')
    expect(o?.counters).toHaveLength(1)
    const l = await structureOf('ArialBlack.ttf', 'l')
    expect(l?.counters).toHaveLength(0)
  })

  it('measures a junction thinner than the stem', async () => {
    const parsed = await load('ArialBlack.ttf')
    const glyph = resolveGlyph(parsed, {}, parsed.cmap.get(0x61)!)
    const structure = analyzeGlyphStructure(glyph.outline, { char: 'a' })
    expect(structure.junction).not.toBeNull()
    expect(structure.junction!.thickness).toBeGreaterThan(0)
    // The join is thinner than the whole letter is wide.
    const width = glyph.bounds.xMax - glyph.bounds.xMin
    expect(structure.junction!.thickness).toBeLessThan(width * 0.6)
  })

  it('leaves construction unclassified for characters with no known pair', async () => {
    const structure = await structureOf('ArialBlack.ttf', 'm')
    expect(structure?.construction).toBe(CONSTRUCTION.Unknown)
  })
})

describeIf('STIXGeneral.otf')('construction of a serif face', () => {
  it('reads the STIX g as double-storey', async () => {
    // Times-style g encloses an upper bowl and a lower loop.
    const structure = await structureOf('STIXGeneral.otf', 'g')
    expect(structure?.construction).toBe(CONSTRUCTION.DoubleStorey)
    expect(structure!.counters.length).toBeGreaterThanOrEqual(2)
  })

  it('reads the STIX a as two-storey', async () => {
    const structure = await structureOf('STIXGeneral.otf', 'a')
    expect(structure?.construction).toBe(CONSTRUCTION.TwoStorey)
  })
})

describeIf('SFNS.ttf')('construction across both forms of a', () => {
  it('separates the two-storey a from its one-storey alternate', async () => {
    const parsed = await load('SFNS.ttf')
    const base = parsed.cmap.get(0x61)!
    const twoStorey = analyzeGlyphStructure(
      resolveGlyph(parsed, {}, base).outline,
      { char: 'a' },
    )
    expect(twoStorey.construction).toBe(CONSTRUCTION.TwoStorey)

    // SF's cv07 alternate is the single-storey form.
    const alternate = analyzeGlyphStructure(
      resolveGlyph(parsed, {}, 620).outline,
      { char: 'a' },
    )
    expect(alternate.construction).toBe(CONSTRUCTION.OneStorey)
  })

  it('gives the one-storey a the same counter profile as o', async () => {
    const parsed = await load('SFNS.ttf')
    const bounds = (index: number) =>
      analyzeGlyphStructure(resolveGlyph(parsed, {}, index).outline, {
        char: 'a',
      })
    const alternate = bounds(620)
    const o = analyzeGlyphStructure(
      resolveGlyph(parsed, {}, parsed.cmap.get(0x6f)!).outline,
      { char: 'o' },
    )
    expect(alternate.counters).toHaveLength(1)
    expect(o.counters).toHaveLength(1)
    // Both are a single bowl, so the counters occupy a similar share.
    const ratio = (s: typeof o) => {
      const c = s.counters[0].bounds
      return c.yMax - c.yMin
    }
    expect(Math.abs(ratio(alternate) - ratio(o)) / ratio(o)).toBeLessThan(0.15)
  })
})

describe('analyzeGlyphStructure on empty input', () => {
  it('does not throw on a glyph with no outline', () => {
    const structure = analyzeGlyphStructure({ contours: [] }, { char: 'a' })
    expect(structure.contourCount).toBe(0)
    expect(structure.counters).toHaveLength(0)
    expect(structure.junction).toBeNull()
    expect(structure.tail).toBeNull()
  })
})
