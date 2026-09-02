import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { ALIGNMENT, compareGlyphs, measureGlyph, overlayOffset } from './compareGlyphs'

// Arial Black declares neither a cap height nor an x-height in OS/2, which is
// exactly why the editor measures them from the outlines and passes them in.
const REFERENCES = [1062, 1466]

const FONT = resolve(__dirname, '../../../test-fonts/ArialBlack.ttf')
const describeIf = existsSync(FONT) ? describe : describe.skip

let cached: ParsedFont | null = null
async function load(): Promise<ParsedFont> {
  if (cached) return cached
  const bytes = readFileSync(FONT)
  cached = await parseFontFile({
    name: 'ArialBlack.ttf',
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  })
  return cached
}

describeIf('comparing two glyphs', () => {
  it('reads the overshoot a round letter is drawn with', async () => {
    const parsed = await load()
    const o = resolveGlyph(parsed, {}, parsed.cmap.get(0x6f)!)
    const x = resolveGlyph(parsed, {}, parsed.cmap.get(0x78)!)

    const round = measureGlyph(o, parsed.verticalMetrics, REFERENCES)
    const flat = measureGlyph(x, parsed.verticalMetrics, REFERENCES)

    // A round letter is drawn past the line a flat one stops at, or it looks
    // smaller than it is. Both are measured against the same x-height.
    expect(round.overshootTop).toBeGreaterThan(0)
    expect(round.overshootTop!).toBeGreaterThan(flat.overshootTop!)
    expect(round.overshootBottom!).toBeLessThan(0)
  })

  it('finds the stems of two straight-sided letters to agree', async () => {
    const parsed = await load()
    const n = resolveGlyph(parsed, {}, parsed.cmap.get(0x6e)!)
    const h = resolveGlyph(parsed, {}, parsed.cmap.get(0x68)!)

    const { rows } = compareGlyphs(n, h, parsed.verticalMetrics)
    const stem = rows.find((r) => r.id === 'stem')!
    expect(stem.matched).toBe(true)
  })

  it('reports a real difference in width rather than rounding it away', async () => {
    const parsed = await load()
    const i = resolveGlyph(parsed, {}, parsed.cmap.get(0x69)!)
    const m = resolveGlyph(parsed, {}, parsed.cmap.get(0x6d)!)

    const { rows } = compareGlyphs(i, m, parsed.verticalMetrics)
    const width = rows.find((r) => r.id === 'width')!
    expect(width.matched).toBe(false)
    expect(width.delta!).toBeGreaterThan(0)
    expect(width.relative!).toBeGreaterThan(1)
  })

  it('counts contours and nodes exactly, not approximately', async () => {
    const parsed = await load()
    const o = resolveGlyph(parsed, {}, parsed.cmap.get(0x6f)!)
    const l = resolveGlyph(parsed, {}, parsed.cmap.get(0x6c)!)

    const { rows } = compareGlyphs(o, l, parsed.verticalMetrics)
    expect(rows.find((r) => r.id === 'contours')!.a).toBe(2)
    expect(rows.find((r) => r.id === 'contours')!.b).toBe(1)
    expect(rows.find((r) => r.id === 'contours')!.matched).toBe(false)
  })

  it('registers the overlay differently depending on the question asked', async () => {
    const parsed = await load()
    const o = resolveGlyph(parsed, {}, parsed.cmap.get(0x6f)!)
    const i = resolveGlyph(parsed, {}, parsed.cmap.get(0x69)!)

    expect(overlayOffset(o, i, ALIGNMENT.Origin)).toBe(0)
    // Aligning the ink moves the narrow letter; aligning the origin does not.
    expect(overlayOffset(o, i, ALIGNMENT.Left)).not.toBe(0)
    expect(overlayOffset(o, i, ALIGNMENT.Centre)).not.toBe(
      overlayOffset(o, i, ALIGNMENT.Left),
    )
  })
})

describeIf('measurements that do not apply', () => {
  it('withholds a horizontal stroke from a letter that has none', async () => {
    const parsed = await load()
    const n = resolveGlyph(parsed, {}, parsed.cmap.get(0x6e)!)
    const e = resolveGlyph(parsed, {}, parsed.cmap.get(0x65)!)

    // Scanning `n` column by column finds full-height stem nearly everywhere,
    // so the median "stroke" is the height of the letter itself. Reporting
    // that as a stroke width invites a comparison that means nothing.
    expect(measureGlyph(n, parsed.verticalMetrics, REFERENCES).stroke).toBeNull()

    // `e` really does have a horizontal bar, and it is measured.
    const bar = measureGlyph(e, parsed.verticalMetrics, REFERENCES).stroke
    expect(bar).not.toBeNull()
    expect(bar!).toBeLessThan(e.bounds.yMax - e.bounds.yMin)
  })

  it('leaves the row present but empty rather than dropping it', async () => {
    const parsed = await load()
    const o = resolveGlyph(parsed, {}, parsed.cmap.get(0x6f)!)
    const n = resolveGlyph(parsed, {}, parsed.cmap.get(0x6e)!)

    const { rows } = compareGlyphs(o, n, parsed.verticalMetrics, REFERENCES)
    const stroke = rows.find((r) => r.id === 'stroke')!
    expect(stroke.b).toBeNull()
    expect(stroke.delta).toBeNull()
    expect(stroke.matched).toBe(false)
  })
})
