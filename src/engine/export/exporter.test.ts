/**
 * Round-trip tests: export a font, then parse the result back and check the
 * geometry survived. This is the only honest way to know the exporter emits
 * a usable font rather than plausible-looking bytes.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GlyphEdits } from '@/types/font'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { outlineBounds } from '@/engine/geometry/outline'
import { inkArea } from '@/engine/geometry/intersect'
import { transformOutline, translation } from '@/engine/geometry/transform'
import { runValidation } from '@/engine/validation/runValidation'
import { exportFont } from './exporter'

const DIR = resolve(__dirname, '../../../test-fonts')
const TTF = resolve(DIR, 'ArialBlack.ttf')
const OTF = resolve(DIR, 'STIXGeneral.otf')
const hasFonts = existsSync(TTF) && existsSync(OTF)

async function load(path: string): Promise<ParsedFont> {
  const bytes = readFileSync(path)
  return parseFontFile({
    name: path.split('/').pop()!,
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  })
}

async function reparse(data: ArrayBuffer, name: string): Promise<ParsedFont> {
  return parseFontFile({ name, buffer: data })
}

/** Compares two outlines by ink area and bounds, tolerant of re-encoding. */
function similarShape(
  a: ReturnType<typeof resolveGlyph>,
  b: ReturnType<typeof resolveGlyph>,
  tolerance = 0.02,
): void {
  const areaA = inkArea(a.outline)
  const areaB = inkArea(b.outline)
  expect(Math.abs(areaA - areaB) / Math.max(1, areaA)).toBeLessThan(tolerance)

  const boundsA = outlineBounds(a.outline)
  const boundsB = outlineBounds(b.outline)
  const span = Math.max(1, boundsA.xMax - boundsA.xMin)
  expect(Math.abs(boundsA.xMin - boundsB.xMin) / span).toBeLessThan(0.02)
  expect(Math.abs(boundsA.xMax - boundsB.xMax) / span).toBeLessThan(0.02)
  expect(Math.abs(boundsA.yMax - boundsB.yMax) / span).toBeLessThan(0.02)
}

const describeIf = hasFonts ? describe : describe.skip

describeIf('exportFont', () => {
  it('round-trips a TrueType font with no edits', async () => {
    const parsed = await load(TTF)
    const result = await exportFont(parsed, {}, {}, { format: 'ttf' })
    const again = await reparse(result.data, 'out.ttf')

    expect(again.metadata.outlineFormat).toBe('truetype')
    expect(again.glyphs).toHaveLength(parsed.glyphs.length)
    expect(again.metadata.mappedCodepoints).toBe(parsed.metadata.mappedCodepoints)
    expect(again.metadata.names.fontFamily).toBe(parsed.metadata.names.fontFamily)

    // Untouched glyphs keep their original bytes, so geometry is identical.
    const a = parsed.cmap.get(0x41)!
    similarShape(
      resolveGlyph(parsed, {}, a),
      resolveGlyph(again, {}, again.cmap.get(0x41)!),
      0.0001,
    )
  })

  it('preserves layout tables it does not model', async () => {
    const parsed = await load(TTF)
    const result = await exportFont(parsed, {}, {}, { format: 'ttf' })
    const again = await reparse(result.data, 'out.ttf')

    const before = new Set(parsed.metadata.tables.map((t) => t.tag))
    const after = new Set(again.metadata.tables.map((t) => t.tag))
    for (const tag of ['GSUB', 'GDEF', 'GPOS', 'cvt ', 'fpgm', 'prep']) {
      if (before.has(tag)) expect(after.has(tag)).toBe(true)
    }
    expect(result.stats.preservedTables).toContain('cmap')
    expect(result.stats.preservedTables).toContain('name')
  })

  it('writes an edited TrueType glyph and reads it back', async () => {
    const parsed = await load(TTF)
    const index = parsed.cmap.get(0x41)!
    const original = resolveGlyph(parsed, {}, index)

    const edits: GlyphEdits = {
      [index]: {
        outline: transformOutline(original.outline, translation(0, 150)),
        advanceWidth: original.advanceWidth + 40,
      },
    }

    const result = await exportFont(parsed, edits, {}, { format: 'ttf' })
    const again = await reparse(result.data, 'out.ttf')
    const roundTripped = resolveGlyph(again, {}, again.cmap.get(0x41)!)

    expect(roundTripped.advanceWidth).toBe(original.advanceWidth + 40)
    expect(roundTripped.bounds.yMax).toBeCloseTo(original.bounds.yMax + 150, -1)
    expect(roundTripped.bounds.yMin).toBeCloseTo(original.bounds.yMin + 150, -1)
    // Quadratic re-fitting keeps the area within a fraction of a percent.
    expect(
      Math.abs(inkArea(roundTripped.outline) - inkArea(original.outline)) /
        inkArea(original.outline),
    ).toBeLessThan(0.005)
  })

  it('round-trips a CFF font and its edits', async () => {
    const parsed = await load(OTF)
    const index = parsed.cmap.get(0x4f)!
    const original = resolveGlyph(parsed, {}, index)

    const edits: GlyphEdits = {
      [index]: {
        outline: transformOutline(original.outline, translation(25, 0)),
        advanceWidth: original.advanceWidth,
      },
    }

    const result = await exportFont(parsed, edits, {}, { format: 'otf' })
    const again = await reparse(result.data, 'out.otf')

    expect(again.metadata.outlineFormat).toBe('cff')
    expect(again.glyphs).toHaveLength(parsed.glyphs.length)

    const roundTripped = resolveGlyph(again, {}, again.cmap.get(0x4f)!)
    expect(roundTripped.bounds.xMin).toBeCloseTo(original.bounds.xMin + 25, 0)
    expect(
      Math.abs(inkArea(roundTripped.outline) - inkArea(original.outline)) /
        inkArea(original.outline),
    ).toBeLessThan(0.002)
  })

  it('keeps glyph names through a CFF rebuild', async () => {
    const parsed = await load(OTF)
    const result = await exportFont(parsed, {}, {}, { format: 'otf' })
    const again = await reparse(result.data, 'out.otf')

    for (const codepoint of [0x41, 0x61, 0x30, 0x4f]) {
      const before = parsed.glyphs[parsed.cmap.get(codepoint)!]
      const after = again.glyphs[again.cmap.get(codepoint)!]
      expect(after.name).toBe(before.name)
    }
  })

  it('converts TrueType outlines to CFF', async () => {
    const parsed = await load(TTF)
    const result = await exportFont(parsed, {}, {}, {
      format: 'otf',
      outlines: 'cff',
    })
    const again = await reparse(result.data, 'out.otf')

    expect(again.metadata.outlineFormat).toBe('cff')
    expect(result.stats.droppedTables).toContain('glyf')
    expect(result.stats.droppedTables).toContain('loca')
    expect(result.warnings.some((w) => w.severity === 'warning')).toBe(true)

    similarShape(
      resolveGlyph(parsed, {}, parsed.cmap.get(0x41)!),
      resolveGlyph(again, {}, again.cmap.get(0x41)!),
      0.005,
    )
  })

  it('converts CFF outlines to TrueType', async () => {
    const parsed = await load(OTF)
    const result = await exportFont(parsed, {}, {}, {
      format: 'ttf',
      outlines: 'truetype',
    })
    const again = await reparse(result.data, 'out.ttf')

    expect(again.metadata.outlineFormat).toBe('truetype')
    expect(result.stats.droppedTables).toContain('CFF ')

    similarShape(
      resolveGlyph(parsed, {}, parsed.cmap.get(0x4f)!),
      resolveGlyph(again, {}, again.cmap.get(0x4f)!),
      0.005,
    )
  })

  it('writes kerning changes into a kern table', async () => {
    const parsed = await load(TTF)
    const a = parsed.cmap.get(0x41)!
    const v = parsed.cmap.get(0x56)!

    const result = await exportFont(parsed, {}, { [`${a},${v}`]: -222 }, {
      format: 'ttf',
    })
    const again = await reparse(result.data, 'out.ttf')

    expect(result.stats.rebuiltTables).toContain('kern')
    // The written kern table parses back with the value we asked for.
    expect(again.otFont.kerningPairs[`${a},${v}`]).toBe(-222)
    expect(again.metadata.tables.some((t) => t.tag === 'kern')).toBe(true)
  })

  it('warns that GPOS kerning takes precedence over the kern table', async () => {
    const parsed = await load(TTF)
    const a = parsed.cmap.get(0x41)!
    const v = parsed.cmap.get(0x56)!
    const hasGpos = parsed.metadata.tables.some((t) => t.tag === 'GPOS')
    if (!hasGpos) return

    const result = await exportFont(parsed, {}, { [`${a},${v}`]: -222 }, {
      format: 'ttf',
    })
    expect(
      result.warnings.some((w) => w.message.includes('GPOS')),
    ).toBe(true)
  })

  it('drops the digital signature', async () => {
    const parsed = await load(TTF)
    const result = await exportFont(parsed, {}, {}, { format: 'ttf' })
    expect(result.stats.preservedTables).not.toContain('DSIG')
  })

  it('produces a font that passes its own QA', async () => {
    const parsed = await load(TTF)
    const result = await exportFont(parsed, {}, {}, { format: 'ttf' })
    const again = await reparse(result.data, 'out.ttf')

    const before = runValidation(parsed, {})
    const after = runValidation(again, {})
    expect(after.errorCount).toBe(0)
    // Re-encoding must not make the font measurably worse.
    expect(after.score).toBeGreaterThanOrEqual(before.score - 2)
  })

  it('wraps as WOFF and unwraps to the same tables', async () => {
    const parsed = await load(TTF)
    const result = await exportFont(parsed, {}, {}, { format: 'woff' })
    expect(result.fileName.endsWith('.woff')).toBe(true)

    const again = await reparse(result.data, 'out.woff')
    expect(again.metadata.container).toBe('woff')
    expect(again.glyphs).toHaveLength(parsed.glyphs.length)
    similarShape(
      resolveGlyph(parsed, {}, parsed.cmap.get(0x41)!),
      resolveGlyph(again, {}, again.cmap.get(0x41)!),
      0.0001,
    )
  })

  it('wraps as WOFF2 and unwraps to the same glyphs', async () => {
    const parsed = await load(TTF)
    const result = await exportFont(parsed, {}, {}, { format: 'woff2' })
    expect(result.fileName.endsWith('.woff2')).toBe(true)
    expect(result.data.byteLength).toBeLessThan(parsed.metadata.fileSize)

    const again = await reparse(result.data, 'out.woff2')
    expect(again.metadata.container).toBe('woff2')
    expect(again.glyphs).toHaveLength(parsed.glyphs.length)
  })

  it('never mutates the imported bytes', async () => {
    const bytes = readFileSync(TTF)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const snapshot = new Uint8Array(buffer).slice()
    const parsed = await parseFontFile({ name: 'a.ttf', buffer })

    await exportFont(parsed, {}, {}, { format: 'ttf' })
    await exportFont(parsed, {}, {}, { format: 'otf', outlines: 'cff' })

    expect(new Uint8Array(parsed.originalFile)).toEqual(snapshot)
  })
})
