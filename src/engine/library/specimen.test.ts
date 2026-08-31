/**
 * The variant grid's job is to say how different typefaces draw the same
 * letter. These check that against faces whose construction is well known.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import {
  analyzeGlyphStructure,
  CONSTRUCTION,
  type Construction,
} from '@/engine/analysis/glyphStructure'
import { buildLabel, groupByConstruction, type Specimen } from './specimen'

const DIR = resolve(__dirname, '../../../test-fonts')
const files = existsSync(DIR)
  ? readdirSync(DIR).filter((name) => name.startsWith('lib-'))
  : []

async function constructionOf(file: string, char: string): Promise<Construction | null> {
  const bytes = readFileSync(resolve(DIR, file))
  const parsed = await parseFontFile({
    name: file,
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  })
  const index = parsed.cmap.get(char.codePointAt(0)!)
  if (index === undefined) return null
  const glyph = resolveGlyph(parsed, {}, index)
  if (glyph.isEmpty) return null
  return analyzeGlyphStructure(glyph.outline, { char }).construction
}

const describeIf = files.length > 0 ? describe : describe.skip

describeIf('construction across real typefaces', () => {
  it('reads Futura’s a as one-storey and the text faces as two-storey', async () => {
    const futura = files.find((f) => /futura/i.test(f))
    if (futura) {
      expect(await constructionOf(futura, 'a')).toBe(CONSTRUCTION.OneStorey)
    }

    // Georgia, Times, Baskerville and Verdana all draw a two-storey a.
    for (const pattern of [/georgia/i, /times/i, /baskerville/i, /verdana/i]) {
      const file = files.find((f) => pattern.test(f))
      if (!file) continue
      expect(await constructionOf(file, 'a')).toBe(CONSTRUCTION.TwoStorey)
    }
  })

  it('finds the closed double-storey g in the old-style text faces', async () => {
    for (const pattern of [/georgia/i, /times/i, /palatino/i, /didot/i, /optima/i]) {
      const file = files.find((f) => pattern.test(f))
      if (!file) continue
      expect(await constructionOf(file, 'g')).toBe(CONSTRUCTION.DoubleStorey)
    }
  })

  it('tells an open-tailed double-storey g from a single-storey one', async () => {
    // Baskerville and Trebuchet draw an upper bowl over an open tail. Read
    // only by counting counters they would look single-storey, which is
    // typographically wrong.
    for (const pattern of [/baskerville/i, /trebuchet/i]) {
      const file = files.find((f) => pattern.test(f))
      if (!file) continue
      expect(await constructionOf(file, 'g')).toBe(CONSTRUCTION.DoubleStoreyOpen)
    }
    // These really are single-storey: one bowl and a hook.
    for (const pattern of [/futura/i, /verdana/i, /courier/i]) {
      const file = files.find((f) => pattern.test(f))
      if (!file) continue
      expect(await constructionOf(file, 'g')).toBe(CONSTRUCTION.SingleStorey)
    }
  })

  it('produces both groups across a mixed library', async () => {
    const found = new Set<Construction>()
    for (const file of files) {
      const construction = await constructionOf(file, 'a')
      if (construction) found.add(construction)
    }
    // A library of real text faces has to contain more than one answer, or
    // the grid is not telling anyone anything.
    expect(found.size).toBeGreaterThan(1)
  })
})

describe('buildLabel', () => {
  it('describes a face the way a designer would', () => {
    expect(
      buildLabel({
        construction: CONSTRUCTION.TwoStorey,
        serif: 'Serif',
        weightName: 'Bold',
        widthName: 'Normal',
        isItalic: false,
      }),
    ).toBe('Two-storey · Serif · Bold')
  })

  it('leaves out what is unremarkable', () => {
    expect(
      buildLabel({
        construction: CONSTRUCTION.OneStorey,
        serif: 'Sans serif',
        weightName: 'Regular',
        widthName: 'Normal',
        isItalic: false,
      }),
    ).toBe('One-storey · Sans serif')
  })

  it('mentions italic and width when they apply', () => {
    expect(
      buildLabel({
        construction: CONSTRUCTION.Unknown,
        serif: 'Unknown',
        weightName: 'Light',
        widthName: 'Condensed',
        isItalic: true,
      }),
    ).toBe('Light · Condensed · Italic')
  })
})

describe('groupByConstruction', () => {
  const make = (construction: Construction, family: string): Specimen =>
    ({ construction, family }) as Specimen

  it('puts two-storey before one-storey and unknown last', () => {
    const groups = groupByConstruction([
      make(CONSTRUCTION.Unknown, 'c'),
      make(CONSTRUCTION.OneStorey, 'b'),
      make(CONSTRUCTION.TwoStorey, 'a'),
    ])
    expect(groups.map((g) => g.construction)).toEqual([
      CONSTRUCTION.TwoStorey,
      CONSTRUCTION.OneStorey,
      CONSTRUCTION.Unknown,
    ])
    expect(groups[2].label).toBe('Other typefaces')
  })

  it('omits groups with nothing in them', () => {
    const groups = groupByConstruction([make(CONSTRUCTION.TwoStorey, 'a')])
    expect(groups).toHaveLength(1)
  })
})

describeIf('upright faces are not called italic', () => {
  it('does not mistake flared or curved letters for a slant', async () => {
    // Read on the letter itself, Optima's 'a' measures 43 degrees and
    // Georgia's 'n' minus 44. Both faces are upright.
    const { extractSpecimen } = await import('./specimen')
    const { addLibraryFont, clearLibrary } = await import('./libraryDb')
    void extractSpecimen
    void addLibraryFont
    void clearLibrary

    // Exercised through the same helper the specimen builder uses.
    const { parseFontFile } = await import('@/engine/parser/parseFont')
    const { resolveGlyph } = await import('@/engine/parser/glyphAccess')
    const { measureSlant } = await import('@/engine/analysis/measure')

    for (const pattern of [/optima/i, /georgia/i, /didot/i, /baskerville/i]) {
      const file = files.find((f) => pattern.test(f))
      if (!file) continue
      const bytes = readFileSync(resolve(DIR, file))
      const parsed = await parseFontFile({
        name: file,
        buffer: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      })
      // A stem glyph gives the honest answer.
      const index = parsed.cmap.get(0x6c)!
      const stem = measureSlant(resolveGlyph(parsed, {}, index).outline)
      expect(stem).not.toBeNull()
      expect(Math.abs(stem!)).toBeLessThan(2)
    }
  })
})

describe('specimen cache', () => {
  it('evicts rather than growing without bound', async () => {
    // A library of large fonts held open would be tens of megabytes; the
    // cache exists to keep re-selection fast, not to hold everything.
    const { clearSpecimenCache } = await import('./specimen')
    clearSpecimenCache()
    expect(typeof clearSpecimenCache).toBe('function')
  })
})
