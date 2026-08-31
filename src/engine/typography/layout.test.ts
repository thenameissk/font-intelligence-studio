import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { layoutText, measureText } from './layout'

const FONT = resolve(__dirname, '../../../test-fonts/ArialBlack.ttf')
const hasFont = existsSync(FONT)

let cached: ParsedFont | null = null
async function loadFont(): Promise<ParsedFont> {
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

const describeIf = hasFont ? describe : describe.skip

describeIf('layoutText', () => {
  it('positions each glyph after the previous advance', async () => {
    const parsed = await loadFont()
    const layout = layoutText(parsed, {}, {}, 'AVA', { kerning: false })
    const [line] = layout.lines

    expect(line.glyphs).toHaveLength(3)
    expect(line.glyphs[0].x).toBe(0)
    expect(line.glyphs[1].x).toBe(line.glyphs[0].advance)
    expect(line.glyphs[2].x).toBe(
      line.glyphs[0].advance + line.glyphs[1].advance,
    )
  })

  it('uses the edited advance width, not the original', async () => {
    const parsed = await loadFont()
    const index = parsed.cmap.get(0x41)!
    const original = layoutText(parsed, {}, {}, 'AA', { kerning: false })
    const edited = layoutText(
      parsed,
      { [index]: { advanceWidth: 100 } },
      {},
      'AA',
      { kerning: false },
    )
    expect(edited.lines[0].width).toBe(200)
    expect(edited.lines[0].width).toBeLessThan(original.lines[0].width)
  })

  it('applies a kerning override', async () => {
    const parsed = await loadFont()
    const a = parsed.cmap.get(0x41)!
    const v = parsed.cmap.get(0x56)!
    const plain = layoutText(parsed, {}, {}, 'AV', { kerning: true })
    const kerned = layoutText(parsed, {}, { [`${a},${v}`]: -200 }, 'AV', {
      kerning: true,
    })
    expect(kerned.lines[0].glyphs[1].kerning).toBe(-200)
    expect(kerned.lines[0].width).toBeLessThan(plain.lines[0].width)
  })

  it('adds tracking between glyphs but not after the last one', async () => {
    const parsed = await loadFont()
    const upm = parsed.verticalMetrics.unitsPerEm
    const plain = layoutText(parsed, {}, {}, 'AAA', { kerning: false })
    const tracked = layoutText(parsed, {}, {}, 'AAA', {
      kerning: false,
      tracking: 100,
    })
    // Two gaps of 0.1 em between three glyphs.
    expect(tracked.lines[0].width - plain.lines[0].width).toBeCloseTo(
      2 * upm * 0.1,
      6,
    )
  })

  it('wraps at the measure', async () => {
    const parsed = await loadFont()
    const width = measureText(parsed, {}, {}, 'hamburgefonstiv')
    const layout = layoutText(
      parsed,
      {},
      {},
      'hamburgefonstiv hamburgefonstiv hamburgefonstiv',
      { maxWidth: width * 1.2 },
    )
    expect(layout.lines).toHaveLength(3)
    for (const line of layout.lines) {
      expect(line.width).toBeLessThanOrEqual(width * 1.25)
    }
  })

  it('keeps explicit line breaks', async () => {
    const parsed = await loadFont()
    const layout = layoutText(parsed, {}, {}, 'one\ntwo\nthree')
    expect(layout.lines).toHaveLength(3)
    expect(layout.lines.map((l) => l.text.trim())).toEqual([
      'one',
      'two',
      'three',
    ])
  })

  it('stacks baselines by the line height', async () => {
    const parsed = await loadFont()
    const upm = parsed.verticalMetrics.unitsPerEm
    const layout = layoutText(parsed, {}, {}, 'a\nb\nc', { lineHeight: 1.5 })
    expect(layout.lines[0].baseline).toBe(0)
    expect(layout.lines[1].baseline).toBeCloseTo(upm * 1.5, 6)
    expect(layout.lines[2].baseline).toBeCloseTo(upm * 3, 6)
  })

  it('centres and right-aligns within the measure', async () => {
    const parsed = await loadFont()
    const measure = 20000
    const left = layoutText(parsed, {}, {}, 'AV', { maxWidth: measure })
    const centre = layoutText(parsed, {}, {}, 'AV', {
      maxWidth: measure,
      align: 'center',
    })
    const right = layoutText(parsed, {}, {}, 'AV', {
      maxWidth: measure,
      align: 'right',
    })
    const slack = measure - left.lines[0].width
    expect(centre.lines[0].glyphs[0].x).toBeCloseTo(slack / 2, 6)
    expect(right.lines[0].glyphs[0].x).toBeCloseTo(slack, 6)
  })

  it('falls back to notdef for characters the font lacks', async () => {
    const parsed = await loadFont()
    const layout = layoutText(parsed, {}, {}, '\u{1F600}', { ligatures: false })
    expect(layout.lines[0].glyphs[0].glyphIndex).toBe(0)
  })

  it('handles an empty string without producing junk', async () => {
    const parsed = await loadFont()
    const layout = layoutText(parsed, {}, {}, '')
    expect(layout.lines).toHaveLength(1)
    expect(layout.lines[0].glyphs).toHaveLength(0)
    expect(layout.width).toBe(0)
  })
})
