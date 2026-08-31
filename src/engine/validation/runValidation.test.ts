import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GlyphEdits } from '@/types/font'
import { parseFontFile } from '@/engine/parser/parseFont'
import { commandsToOutline } from '@/engine/geometry/outline'
import { runValidation } from './runValidation'

const FONT = resolve(__dirname, '../../../test-fonts/ArialBlack.ttf')
const hasFont = existsSync(FONT)

async function loadFont() {
  const bytes = readFileSync(FONT)
  return parseFontFile({
    name: 'ArialBlack.ttf',
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  })
}

const describeIf = hasFont ? describe : describe.skip

describeIf('runValidation', () => {
  it('gives a shipping font a high score and no errors', async () => {
    const parsed = await loadFont()
    const report = runValidation(parsed, {})

    expect(report.glyphsChecked).toBe(parsed.glyphs.length)
    expect(report.errorCount).toBe(0)
    expect(report.score).toBeGreaterThan(80)
    expect(report.metricsValid).toBe(true)
  })

  it('detects an outline we deliberately break', async () => {
    const parsed = await loadFont()
    const index = parsed.cmap.get(0x41)!

    // A bow tie: the contour crosses itself.
    const broken: GlyphEdits = {
      [index]: {
        outline: commandsToOutline([
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: 500, y: 500 },
          { type: 'L', x: 500, y: 0 },
          { type: 'L', x: 0, y: 500 },
          { type: 'Z' },
        ]),
        advanceWidth: 600,
      },
    }

    const report = runValidation(parsed, broken)
    const forGlyph = report.issues.filter((i) => i.glyphIndex === index)
    const crossing = forGlyph.find((i) => i.code === 'self-intersection')
    expect(crossing).toBeDefined()
    // A contour crossing itself is a real defect, but not a blocking one:
    // it still exports, it just fills wrongly.
    expect(crossing!.severity).toBe('warning')
    expect(crossing!.point).toBeDefined()
  })

  it('treats overlapping contours as information, not a defect', async () => {
    const parsed = await loadFont()
    // Accented glyphs are routinely built by overlapping the accent on the
    // base, so this must not be reported as an error.
    const report = runValidation(parsed, {})
    const overlaps = report.issues.filter(
      (i) => i.code === 'self-intersection' && i.title === 'Overlapping contours',
    )
    expect(overlaps.every((i) => i.severity === 'info')).toBe(true)
  })

  it('does not flag combining marks for having no advance', async () => {
    const parsed = await loadFont()
    const report = runValidation(parsed, {})
    const markIndex = parsed.cmap.get(0x0301)
    if (markIndex === undefined) return
    const forMark = report.issues.filter(
      (i) => i.glyphIndex === markIndex && i.code === 'invalid-metrics',
    )
    expect(forMark).toEqual([])
  })

  it('detects a negative advance width', async () => {
    const parsed = await loadFont()
    const index = parsed.cmap.get(0x42)!
    const report = runValidation(parsed, {
      [index]: { advanceWidth: -50 },
    })
    const found = report.issues.find(
      (i) => i.glyphIndex === index && i.code === 'invalid-metrics',
    )
    expect(found).toBeDefined()
    expect(found!.severity).toBe('error')
    expect(report.metricsValid).toBe(false)
  })

  it('detects an open contour', async () => {
    const parsed = await loadFont()
    const index = parsed.cmap.get(0x43)!
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 300, y: 0 },
      { type: 'L', x: 300, y: 300 },
    ])
    const report = runValidation(parsed, {
      [index]: { outline, advanceWidth: 400 },
    })
    expect(
      report.issues.some(
        (i) => i.glyphIndex === index && i.code === 'open-contour',
      ),
    ).toBe(true)
  })

  it('detects a duplicated node', async () => {
    const parsed = await loadFont()
    const index = parsed.cmap.get(0x44)!
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 300, y: 0 },
      { type: 'L', x: 300, y: 0.0001 },
      { type: 'L', x: 300, y: 300 },
      { type: 'L', x: 0, y: 300 },
      { type: 'Z' },
    ])
    const report = runValidation(parsed, {
      [index]: { outline, advanceWidth: 400 },
    })
    expect(
      report.issues.some(
        (i) => i.glyphIndex === index && i.code === 'duplicate-node',
      ),
    ).toBe(true)
  })

  it('every issue points at a real glyph or is font-level', async () => {
    const parsed = await loadFont()
    const report = runValidation(parsed, {})
    for (const found of report.issues) {
      if (found.glyphIndex === null) continue
      expect(found.glyphIndex).toBeGreaterThanOrEqual(0)
      expect(found.glyphIndex).toBeLessThan(parsed.glyphs.length)
      expect(found.glyphName).toBe(parsed.glyphs[found.glyphIndex].name)
    }
  })

  it('sorts errors ahead of warnings and notes', async () => {
    const parsed = await loadFont()
    const index = parsed.cmap.get(0x45)!
    const report = runValidation(parsed, { [index]: { advanceWidth: -10 } })
    const order = { error: 0, warning: 1, info: 2 } as const
    for (let i = 1; i < report.issues.length; i += 1) {
      expect(
        order[report.issues[i].severity],
      ).toBeGreaterThanOrEqual(order[report.issues[i - 1].severity])
    }
  })

  it('finishes a whole font quickly enough to run interactively', async () => {
    const parsed = await loadFont()
    const report = runValidation(parsed, {})
    expect(report.durationMs).toBeLessThan(8000)
  })
})
