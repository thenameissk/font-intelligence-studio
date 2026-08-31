/**
 * Performance budgets.
 *
 * The target is a font with thousands of glyphs staying interactive, so
 * these assert budgets rather than exact timings: they catch a regression
 * that makes something an order of magnitude slower without failing on a
 * slow machine.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { analyzeFontDna } from '@/engine/analysis/fontDna'
import { createDnaSource } from '@/engine/analysis/dnaSource'
import { runValidation } from '@/engine/validation/runValidation'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import { filterGlyphs } from '@/features/glyph-browser/glyphSearch'
import { hasOverlap } from '@/engine/geometry/boolean'
import { simplifyOutline } from '@/engine/geometry/simplify'
import { analyzeVariants } from '@/engine/analysis/variants'

const CANDIDATES = [
  '/System/Library/Fonts/Apple Symbols.ttf',
  '/System/Library/Fonts/Geneva.ttf',
  '/System/Library/Fonts/Supplemental/Courier New.ttf',
]
const LARGE = CANDIDATES.find((path) => existsSync(path))

function time(label: string, fn: () => void): number {
  const started = performance.now()
  fn()
  const elapsed = performance.now() - started
  process.stderr.write(`\n  ${label}: ${elapsed.toFixed(1)} ms`)
  return elapsed
}

const describeIf = LARGE ? describe : describe.skip

describeIf('performance on a large font', () => {
  let font: ParsedFont

  it('parses and indexes a multi-thousand glyph font quickly', async () => {
    const bytes = readFileSync(LARGE!)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer

    const started = performance.now()
    font = await parseFontFile({ name: 'large.ttf', buffer })
    const elapsed = performance.now() - started
    process.stderr.write(
      `\n  parse + index (${font.glyphs.length} glyphs): ${elapsed.toFixed(1)} ms`,
    )

    expect(font.glyphs.length).toBeGreaterThan(2000)
    // Import must feel immediate, not like a load screen.
    expect(elapsed).toBeLessThan(3000)
  })

  it('renders a browser page of glyphs within a frame budget', () => {
    // The virtualised grid mounts roughly this many cells at a time.
    const elapsed = time('60 glyph previews', () => {
      for (let index = 0; index < 60; index += 1) {
        const glyph = resolveGlyph(font, {}, index)
        outlineToSvgPathData(glyph.outline)
      }
    })
    expect(elapsed).toBeLessThan(120)
  })

  it('re-renders the same page from cache almost instantly', () => {
    for (let index = 0; index < 60; index += 1) resolveGlyph(font, {}, index)
    const elapsed = time('60 previews, warm', () => {
      for (let index = 0; index < 60; index += 1) resolveGlyph(font, {}, index)
    })
    expect(elapsed).toBeLessThan(15)
  })

  it('filters the whole glyph index fast enough to type against', () => {
    const elapsed = time('filter all glyphs', () => {
      for (const query of ['a', 'ar', 'arr', 'arro', 'arrow']) {
        filterGlyphs(font.index, { query, category: 'all', hideEmpty: false })
      }
    })
    expect(elapsed).toBeLessThan(150)
  })

  it('computes Font DNA without blocking a frame for long', () => {
    const elapsed = time('font DNA', () => {
      analyzeFontDna(createDnaSource(font, {}))
    })
    expect(elapsed).toBeLessThan(600)
  })

  it('validates the whole font inside the worker budget', () => {
    const elapsed = time('full validation', () => {
      runValidation(font, {})
    })
    process.stderr.write('\n')
    // This runs in a worker, so the budget is generous; it just must not
    // become minutes.
    expect(elapsed).toBeLessThan(8000)
  })
})

describeIf('path operations on a real glyph', () => {
  it('checks for overlap fast enough to run on every edit', async () => {
    const bytes = readFileSync(LARGE!)
    const parsed = await parseFontFile({
      name: 'large.ttf',
      buffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    })

    // The most complex glyph we can find, as a worst case.
    let worst = { index: 0, nodes: 0 }
    for (let index = 0; index < Math.min(600, parsed.glyphs.length); index += 1) {
      const glyph = resolveGlyph(parsed, {}, index)
      const nodes = glyph.outline.contours.reduce((n, c) => n + c.nodes.length, 0)
      if (nodes > worst.nodes) worst = { index, nodes }
    }

    const glyph = resolveGlyph(parsed, {}, worst.index)
    const elapsed = time(`hasOverlap on ${worst.nodes} nodes`, () => {
      hasOverlap(glyph.outline)
    })
    // The panel runs this on every outline change, so it has a frame budget.
    expect(elapsed).toBeLessThan(120)
  })

  it('simplifies a complex glyph quickly', async () => {
    const bytes = readFileSync(LARGE!)
    const parsed = await parseFontFile({
      name: 'large.ttf',
      buffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    })
    const index = parsed.cmap.get(0x40) ?? 40
    const glyph = resolveGlyph(parsed, {}, index)
    const elapsed = time('simplify', () => {
      simplifyOutline(glyph.outline, { tolerance: 1 })
    })
    process.stderr.write('\n')
    expect(elapsed).toBeLessThan(400)
  })
})

describeIf('variant suggestions', () => {
  it('analyses variants fast enough to run on selection', async () => {
    const bytes = readFileSync(LARGE!)
    const parsed = await parseFontFile({
      name: 'large.ttf',
      buffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    })
    const index = parsed.cmap.get(0x61)
    if (index === undefined) return

    const elapsed = time('analyzeVariants', () => {
      analyzeVariants(parsed, {}, index)
    })
    process.stderr.write('\n')
    // This runs whenever the selection changes, so it has a frame budget.
    expect(elapsed).toBeLessThan(250)
  })
})

describeIf('image tracing', () => {
  it('traces a large image inside an interactive budget', async () => {
    const { createGray } = await import('@/engine/raster/types')
    const { analyzeThreshold, inkField } = await import('@/engine/raster/threshold')
    const { blurField, defaultBlurRadius } = await import('@/engine/raster/blur')
    const { traceContours } = await import('@/engine/raster/trace')
    const { vectorizePolygons } = await import('@/engine/raster/vectorize')

    // The largest the decoder will hand over, after its downscale.
    const size = 1100
    const image = createGray(size, size, 255)
    const c = size / 2
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const d = Math.hypot(x - c, y - c)
        if (d < size * 0.42 && d > size * 0.22) image.data[y * size + x] = 0
      }
    }

    const elapsed = time(`trace ${size}x${size}`, () => {
      const options = analyzeThreshold(image)
      const raw = inkField(image, options)
      const field = blurField(raw.field, size, size, defaultBlurRadius(image))
      const polygons = traceContours(field, size, size, { isoLevel: raw.isoLevel })
      vectorizePolygons(polygons, { tolerance: 2 })
    })
    process.stderr.write('\n')
    // Re-traced on every threshold change, so it has to stay responsive.
    expect(elapsed).toBeLessThan(2500)
  })
})
