import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile } from './parseFont'
import { resolveGlyph } from './glyphAccess'
import { detectContainer } from './decode'
import { buildSfnt, calcTableChecksum, readTableDirectory } from './sfnt'
import { outlineBounds } from '@/engine/geometry/outline'

const FONT_DIR = resolve(__dirname, '../../../test-fonts')

function load(name: string): { name: string; buffer: ArrayBuffer } {
  const path = resolve(FONT_DIR, name)
  const buffer = readFileSync(path)
  return {
    name,
    buffer: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  }
}

const hasFixtures = existsSync(resolve(FONT_DIR, 'ArialBlack.ttf'))
const describeFonts = hasFixtures ? describe : describe.skip

describe('sfnt', () => {
  it('computes the spec table checksum with zero padding', () => {
    // 0x01020304 + 0x05000000 (padded tail)
    const data = new Uint8Array([1, 2, 3, 4, 5])
    expect(calcTableChecksum(data)).toBe((0x01020304 + 0x05000000) >>> 0)
  })

  it('rebuilds a font that still parses and keeps every table', () => {
    if (!hasFixtures) return
    const { buffer } = load('ArialBlack.ttf')
    const directory = readTableDirectory(buffer)
    const rebuilt = buildSfnt(
      directory.sfntVersion,
      directory.tables.map((table) => ({
        tag: table.tag,
        data: new Uint8Array(buffer, table.offset, table.length),
      })),
    )
    const after = readTableDirectory(rebuilt)
    expect(after.tables.map((t) => t.tag).sort()).toEqual(
      directory.tables.map((t) => t.tag).sort(),
    )
    // head.checkSumAdjustment makes the whole-file checksum a fixed constant.
    expect(calcTableChecksum(new Uint8Array(rebuilt))).toBe(0xb1b0afba)
  })
})

describeFonts('parseFontFile', () => {
  it('parses a TrueType font end to end', async () => {
    const parsed = await parseFontFile(load('ArialBlack.ttf'))

    expect(parsed.metadata.outlineFormat).toBe('truetype')
    expect(parsed.metadata.container).toBe('sfnt')
    expect(parsed.metadata.names.fontFamily).toContain('Arial')
    expect(parsed.metadata.numGlyphs).toBeGreaterThan(200)
    expect(parsed.glyphs).toHaveLength(parsed.metadata.numGlyphs)
    expect(parsed.verticalMetrics.unitsPerEm).toBe(2048)
    expect(parsed.metadata.mappedCodepoints).toBeGreaterThan(100)
    expect(parsed.metadata.tables.some((t) => t.tag === 'glyf')).toBe(true)
  })

  it('parses a CFF font end to end', async () => {
    const parsed = await parseFontFile(load('STIXGeneral.otf'))
    expect(parsed.metadata.outlineFormat).toBe('cff')
    expect(parsed.verticalMetrics.unitsPerEm).toBe(1000)
    expect(parsed.metadata.features.map((f) => f.tag)).toContain('kern')
  })

  it('exposes real outline geometry for a known glyph', async () => {
    const parsed = await parseFontFile(load('ArialBlack.ttf'))
    const index = parsed.cmap.get(0x41)
    expect(index).toBeDefined()

    const glyph = resolveGlyph(parsed, {}, index!)
    expect(glyph.name).toBe('A')
    expect(glyph.isEmpty).toBe(false)
    // 'A' has an outer contour and a counter.
    expect(glyph.outline.contours.length).toBe(2)
    expect(glyph.bounds.yMin).toBeCloseTo(0, 0)
    expect(glyph.bounds.yMax).toBeGreaterThan(1000)
    expect(glyph.advanceWidth).toBeGreaterThan(0)
    expect(glyph.leftSideBearing).toBe(glyph.bounds.xMin)
    expect(glyph.rightSideBearing).toBe(
      glyph.advanceWidth - glyph.bounds.xMax,
    )
    expect(glyph.modified).toBe(false)
  })

  it('resolves composite glyphs into real contours', async () => {
    const parsed = await parseFontFile(load('ArialBlack.ttf'))
    const index = parsed.cmap.get(0xc1) // A-acute
    expect(index).toBeDefined()

    const glyph = resolveGlyph(parsed, {}, index!)
    expect(glyph.isComposite).toBe(true)
    expect(glyph.components.length).toBeGreaterThan(0)
    // Composite outlines are fully resolved, so the accent lifts the top.
    const base = resolveGlyph(parsed, {}, parsed.cmap.get(0x41)!)
    expect(outlineBounds(glyph.outline).yMax).toBeGreaterThan(
      outlineBounds(base.outline).yMax,
    )
  })

  it('applies the edit overlay without touching the source font', async () => {
    const parsed = await parseFontFile(load('ArialBlack.ttf'))
    const index = parsed.cmap.get(0x41)!
    const original = resolveGlyph(parsed, {}, index)

    const edited = resolveGlyph(
      parsed,
      { [index]: { advanceWidth: original.advanceWidth + 100 } },
      index,
    )
    expect(edited.advanceWidth).toBe(original.advanceWidth + 100)
    expect(edited.modified).toBe(true)
    // Re-resolving with no edits returns the untouched original.
    expect(resolveGlyph(parsed, {}, index).advanceWidth).toBe(
      original.advanceWidth,
    )
  })

  it('memoises resolution while the edit reference is unchanged', async () => {
    const parsed = await parseFontFile(load('ArialBlack.ttf'))
    const index = parsed.cmap.get(0x41)!
    const edits = {}
    expect(resolveGlyph(parsed, edits, index)).toBe(
      resolveGlyph(parsed, edits, index),
    )
  })

  it('rejects files that are not fonts', async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer
    expect(detectContainer(junk)).toBeNull()
    await expect(
      parseFontFile({ name: 'junk.ttf', buffer: junk }),
    ).rejects.toThrow(/Unrecognised file format/)
  })

  it('rejects a truncated font without crashing', async () => {
    const { buffer } = load('ArialBlack.ttf')
    await expect(
      parseFontFile({ name: 'cut.ttf', buffer: buffer.slice(0, 60) }),
    ).rejects.toBeInstanceOf(Error)
  })
})
