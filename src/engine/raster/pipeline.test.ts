/**
 * Image to editable glyph, end to end: threshold, trace, fit curves, place
 * into the font's metrics.
 */
import { describe, expect, it } from 'vitest'
import { createGray, type GrayImage } from './types'
import { analyzeThreshold, inkField } from './threshold'
import { traceContours } from './trace'
import { simplifyPolyline, vectorizePolygons } from './vectorize'
import {
  fitOutlineToMetrics,
  normalizeWinding,
  SOURCE_SPACE,
  VERTICAL_FIT,
  HORIZONTAL_FIT,
} from './fitToMetrics'
import {
  commandsToOutline,
  countNodes,
  outlineBounds,
  contourDirection,
} from '@/engine/geometry/outline'
import type { PathCommand } from 'opentype.js'
import { inkArea } from '@/engine/geometry/intersect'
import { contourIsOuter } from '@/engine/geometry/nesting'
import type { VerticalMetrics } from '@/types/font'

const METRICS: VerticalMetrics = {
  unitsPerEm: 1000,
  ascender: 750,
  descender: -250,
  lineGap: 0,
  typoAscender: null,
  typoDescender: null,
  typoLineGap: null,
  winAscent: null,
  winDescent: null,
  capHeight: 700,
  xHeight: 520,
  underlinePosition: null,
  underlineThickness: null,
  italicAngle: 0,
}

function ring(size: number, cx: number, cy: number, outer: number, inner: number): GrayImage {
  const image = createGray(size, size, 255)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const coverage =
        Math.max(0, Math.min(1, outer + 0.5 - d)) *
        Math.max(0, Math.min(1, d - inner + 0.5))
      image.data[y * size + x] = Math.round(255 * (1 - coverage))
    }
  }
  return image
}

/** An asymmetric shape, so a y-flip is detectable. */
function wedge(size: number): GrayImage {
  const image = createGray(size, size, 255)
  for (let y = 0; y < size; y += 1) {
    // Wide at the top of the image, narrow at the bottom.
    const halfWidth = ((size - y) / size) * (size * 0.4)
    for (let x = 0; x < size; x += 1) {
      if (Math.abs(x - size / 2) <= halfWidth) image.data[y * size + x] = 0
    }
  }
  return image
}

function vectorize(image: GrayImage) {
  const options = analyzeThreshold(image)
  const { field, isoLevel } = inkField(image, options)
  const polygons = traceContours(field, image.width, image.height, { isoLevel })
  return vectorizePolygons(polygons, { tolerance: 0.8 })
}

describe('simplifyPolyline', () => {
  it('reduces a straight run to its endpoints', () => {
    const points = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }))
    expect(simplifyPolyline(points, 0.1)).toHaveLength(2)
  })

  it('keeps a corner', () => {
    const points = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 19, y: i })),
    ]
    const simplified = simplifyPolyline(points, 0.5)
    expect(simplified.length).toBeGreaterThanOrEqual(3)
    expect(simplified.some((p) => p.x === 19 && p.y === 0)).toBe(true)
  })
})

describe('vectorizePolygons', () => {
  it('turns a traced ring into two editable contours', () => {
    const result = vectorize(ring(160, 80, 80, 55, 30))
    expect(result.contourCount).toBe(2)
    // Curves, not a polygon dump.
    expect(result.nodeCount).toBeLessThan(60)
    expect(result.nodeCount).toBeGreaterThan(6)
  })

  it('keeps the traced area through the curve fit', () => {
    const result = vectorize(ring(200, 100, 100, 70, 40))
    const expected = Math.PI * (70 * 70 - 40 * 40)
    // Fitting is an approximation; a couple of percent is the honest bar.
    expect(Math.abs(inkArea(result.outline) - expected) / expected).toBeLessThan(0.03)
  })

  it('preserves sharp corners rather than rounding them off', () => {
    const image = createGray(120, 120, 255)
    for (let y = 30; y < 90; y += 1) {
      for (let x = 30; x < 90; x += 1) image.data[y * 120 + x] = 0
    }
    const result = vectorize(image)
    expect(result.contourCount).toBe(1)
    // A square needs about four nodes, not a smooth blob.
    expect(result.nodeCount).toBeLessThanOrEqual(10)
    const bounds = outlineBounds(result.outline)
    expect(bounds.xMax - bounds.xMin).toBeGreaterThan(58)
    expect(bounds.xMax - bounds.xMin).toBeLessThan(62)
  })

  it('produces finite coordinates', () => {
    const result = vectorize(ring(140, 70, 70, 50, 25))
    for (const contour of result.outline.contours) {
      for (const node of contour.nodes) {
        expect(Number.isFinite(node.x)).toBe(true)
        expect(Number.isFinite(node.y)).toBe(true)
      }
    }
  })
})

describe('fitOutlineToMetrics', () => {
  const target = {
    bounds: { xMin: 60, yMin: 0, xMax: 460, yMax: 520 },
    advanceWidth: 520,
    isEmpty: false,
  }

  it('flips the image the right way up', () => {
    // The wedge is wide at the top in image space, so after the flip its
    // widest part must be at the top in type space too.
    const traced = vectorize(wedge(120))
    const fitted = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
    })

    const bounds = outlineBounds(fitted.outline)
    const widthNear = (y: number): number => {
      const xs = fitted.outline.contours
        .flatMap((c) => c.nodes)
        .filter((n) => Math.abs(n.y - y) < (bounds.yMax - bounds.yMin) * 0.12)
        .map((n) => n.x)
      return xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0
    }
    expect(widthNear(bounds.yMax)).toBeGreaterThan(widthNear(bounds.yMin))
  })

  it('never takes the advance width from the image', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const fitted = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
    })
    expect(fitted.advanceWidth).toBe(520)
  })

  it('scales to the height of the glyph it replaces', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const fitted = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      vertical: VERTICAL_FIT.GlyphBounds,
      outlineFormat: 'truetype',
    })
    const bounds = outlineBounds(fitted.outline)
    expect(bounds.yMin).toBeCloseTo(0, 0)
    expect(bounds.yMax).toBeCloseTo(520, 0)
  })

  it('scales to the x-height when asked', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const fitted = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      vertical: VERTICAL_FIT.XHeight,
      outlineFormat: 'truetype',
    })
    const bounds = outlineBounds(fitted.outline)
    expect(bounds.yMax - bounds.yMin).toBeCloseTo(520, 0)
    expect(bounds.yMin).toBeCloseTo(0, 0)
  })

  it('keeps the font’s left bearing', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const fitted = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
    })
    expect(outlineBounds(fitted.outline).xMin).toBeCloseTo(60, 0)
  })

  it('preserves proportions unless asked to match width', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const keep = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      horizontal: HORIZONTAL_FIT.KeepAspect,
      outlineFormat: 'truetype',
    })
    const stretch = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      horizontal: HORIZONTAL_FIT.MatchWidth,
      outlineFormat: 'truetype',
    })

    const keepBounds = outlineBounds(keep.outline)
    const stretchBounds = outlineBounds(stretch.outline)
    // The traced ring is square, the target box is not.
    expect(keepBounds.xMax - keepBounds.xMin).toBeCloseTo(520, 0)
    expect(stretchBounds.xMax - stretchBounds.xMin).toBeCloseTo(400, 0)
  })

  it('explains what it did', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const fitted = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
    })
    expect(fitted.notes.join(' ')).toMatch(/height of the glyph/i)
    expect(fitted.notes.join(' ')).toMatch(/bearing/i)
  })
})

describe('normalizeWinding', () => {
  it('sets TrueType outer contours clockwise and counters the other way', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const wound = normalizeWinding(traced.outline, 'truetype')
    const outer = contourIsOuter(wound)
    wound.contours.forEach((contour, index) => {
      expect(contourDirection(contour)).toBe(outer[index] ? 'cw' : 'ccw')
    })
  })

  it('sets PostScript outer contours counter-clockwise', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const wound = normalizeWinding(traced.outline, 'cff')
    const outer = contourIsOuter(wound)
    wound.contours.forEach((contour, index) => {
      expect(contourDirection(contour)).toBe(outer[index] ? 'ccw' : 'cw')
    })
  })

  it('does not change how much ink there is', () => {
    const traced = vectorize(ring(200, 100, 100, 80, 40))
    const before = inkArea(traced.outline)
    const after = inkArea(normalizeWinding(traced.outline, 'truetype'))
    expect(Math.abs(after - before) / before).toBeLessThan(0.001)
  })
})

describe('end to end', () => {
  it('turns a photographed ring into an editable glyph in the font’s frame', () => {
    const image = ring(240, 120, 120, 95, 52)
    const traced = vectorize(image)
    const fitted = fitOutlineToMetrics(traced.outline, {
      metrics: METRICS,
      target: {
        bounds: { xMin: 40, yMin: 0, xMax: 480, yMax: 700 },
        advanceWidth: 540,
        isEmpty: false,
      },
      vertical: VERTICAL_FIT.CapHeight,
      outlineFormat: 'cff',
    })

    expect(fitted.outline.contours).toHaveLength(2)
    expect(countNodes(fitted.outline)).toBeGreaterThan(6)
    expect(fitted.advanceWidth).toBe(540)

    const bounds = outlineBounds(fitted.outline)
    expect(bounds.yMin).toBeCloseTo(0, 0)
    expect(bounds.yMax).toBeCloseTo(700, 0)
    expect(inkArea(fitted.outline)).toBeGreaterThan(0)
  })
})

describe('borrowing a glyph from another font', () => {
  const target = {
    bounds: { xMin: 60, yMin: -250, xMax: 460, yMax: 500 },
    advanceWidth: 560,
    isEmpty: false,
  }

  /** A 'p': bowl from baseline to x-height, stem descending below. */
  function pShape(xHeight: number, descender: number): PathCommand[] {
    return [
      { type: 'M', x: 0, y: descender },
      { type: 'L', x: 120, y: descender },
      { type: 'L', x: 120, y: xHeight },
      { type: 'L', x: 0, y: xHeight },
      { type: 'Z' },
      { type: 'M', x: 140, y: 0 },
      { type: 'L', x: 500, y: 0 },
      { type: 'L', x: 500, y: xHeight },
      { type: 'L', x: 140, y: xHeight },
      { type: 'Z' },
    ]
  }

  const sourceMetrics = { unitsPerEm: 1000, xHeight: 500, capHeight: 700 }

  it('keeps the descender below the baseline', () => {
    // Fitting by bounding box squashes bowl and descender together into the
    // x-height: the letter lands a third too small, sitting on the baseline
    // with no descender at all.
    const fitted = fitOutlineToMetrics(commandsToOutline(pShape(500, -250)), {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
      vertical: VERTICAL_FIT.XHeight,
      sourceSpace: SOURCE_SPACE.Font,
      sourceMetrics,
    })
    const bounds = outlineBounds(fitted.outline)
    expect(bounds.yMax).toBeCloseTo(METRICS.xHeight!, 0)
    // Still descending, scaled by the same ratio as the rest of the letter.
    expect(bounds.yMin).toBeLessThan(-200)
  })

  it('rescales by the ratio of the two x-heights', () => {
    // Source x-height 500, target 520: everything grows by 4%.
    const fitted = fitOutlineToMetrics(commandsToOutline(pShape(500, -250)), {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
      vertical: VERTICAL_FIT.XHeight,
      sourceSpace: SOURCE_SPACE.Font,
      sourceMetrics,
    })
    const bounds = outlineBounds(fitted.outline)
    const ratio = METRICS.xHeight! / 500
    expect(bounds.yMax).toBeCloseTo(500 * ratio, 0)
    expect(bounds.yMin).toBeCloseTo(-250 * ratio, 0)
  })

  it('scales a font with a different em the same way', () => {
    // A 2048-unit font with a 1024 x-height must land identically to a
    // 1000-unit font with a 500 x-height: same proportion, same result.
    const big = fitOutlineToMetrics(commandsToOutline(pShape(1024, -512)), {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
      vertical: VERTICAL_FIT.XHeight,
      sourceSpace: SOURCE_SPACE.Font,
      sourceMetrics: { unitsPerEm: 2048, xHeight: 1024, capHeight: 1434 },
    })
    const bounds = outlineBounds(big.outline)
    expect(bounds.yMax).toBeCloseTo(METRICS.xHeight!, 0)
  })

  it('still keeps the font’s own advance and left bearing', () => {
    const fitted = fitOutlineToMetrics(commandsToOutline(pShape(500, -250)), {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
      vertical: VERTICAL_FIT.XHeight,
      sourceSpace: SOURCE_SPACE.Font,
      sourceMetrics,
    })
    expect(fitted.advanceWidth).toBe(560)
    expect(outlineBounds(fitted.outline).xMin).toBeCloseTo(60, 0)
  })

  it('uses cap height when asked, for an uppercase letter', () => {
    const fitted = fitOutlineToMetrics(commandsToOutline(pShape(700, 0)), {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
      vertical: VERTICAL_FIT.CapHeight,
      sourceSpace: SOURCE_SPACE.Font,
      sourceMetrics,
    })
    expect(outlineBounds(fitted.outline).yMax).toBeCloseTo(METRICS.capHeight!, 0)
  })

  it('says what it did', () => {
    const fitted = fitOutlineToMetrics(commandsToOutline(pShape(500, -250)), {
      metrics: METRICS,
      target,
      outlineFormat: 'truetype',
      vertical: VERTICAL_FIT.XHeight,
      sourceSpace: SOURCE_SPACE.Font,
      sourceMetrics,
    })
    expect(fitted.notes.join(' ')).toMatch(/x-height/i)
    expect(fitted.notes.join(' ')).toMatch(/baseline aligned/i)
  })
})
