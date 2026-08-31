import { describe, expect, it } from 'vitest'
import { createGray, type GrayImage } from './types'
import { analyzeThreshold, inkField, otsuThreshold } from './threshold'
import { polygonArea, traceContours } from './trace'

/** Draws a filled disc of dark ink on white. */
function disc(size: number, cx: number, cy: number, r: number): GrayImage {
  const image = createGray(size, size, 255)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      // Soft edge over one pixel, as a real rasteriser would produce.
      const coverage = Math.max(0, Math.min(1, r + 0.5 - d))
      image.data[y * size + x] = Math.round(255 * (1 - coverage))
    }
  }
  return image
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

function box(size: number, x0: number, y0: number, x1: number, y1: number): GrayImage {
  const image = createGray(size, size, 255)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) image.data[y * size + x] = 0
  }
  return image
}

function trace(image: GrayImage) {
  const options = analyzeThreshold(image)
  const { field, isoLevel } = inkField(image, options)
  return traceContours(field, image.width, image.height, { isoLevel })
}

describe('otsuThreshold', () => {
  it('separates a two-tone image between its tones', () => {
    const image = box(40, 10, 10, 30, 30)
    const level = otsuThreshold(image)
    expect(level).toBeGreaterThanOrEqual(0)
    expect(level).toBeLessThan(255)
  })

  it('recognises ink as the smaller group, whichever tone it is', () => {
    const darkOnLight = box(40, 15, 15, 25, 25)
    expect(analyzeThreshold(darkOnLight).inkIsDark).toBe(true)

    // The same shape inverted: light ink on a dark ground.
    const lightOnDark = createGray(40, 40, 0)
    for (let y = 15; y < 25; y += 1) {
      for (let x = 15; x < 25; x += 1) lightOnDark.data[y * 40 + x] = 255
    }
    expect(analyzeThreshold(lightOnDark).inkIsDark).toBe(false)
  })
})

describe('traceContours', () => {
  it('finds one loop around a solid square', () => {
    const polygons = trace(box(60, 20, 20, 40, 40))
    expect(polygons).toHaveLength(1)
    // A 20x20 square, within a pixel either way.
    expect(Math.abs(polygons[0].signedArea)).toBeGreaterThan(360)
    expect(Math.abs(polygons[0].signedArea)).toBeLessThan(440)
  })

  it('recovers the area of a disc to within a percent', () => {
    const r = 30
    const polygons = trace(disc(100, 50, 50, r))
    expect(polygons).toHaveLength(1)
    const expected = Math.PI * r * r
    const measured = Math.abs(polygons[0].signedArea)
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01)
  })

  it('is sub-pixel accurate, not staircased', () => {
    // A staircase trace of a disc overshoots its area noticeably; linear
    // interpolation across the edge keeps it close.
    const polygons = trace(disc(80, 40, 40, 25))
    const expected = Math.PI * 25 * 25
    expect(Math.abs(Math.abs(polygons[0].signedArea) - expected) / expected)
      .toBeLessThan(0.008)
  })

  it('finds both loops of a ring, wound in opposite directions', () => {
    const polygons = trace(ring(120, 60, 60, 40, 22))
    expect(polygons).toHaveLength(2)
    const [outer, inner] = polygons.sort(
      (a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea),
    )
    expect(Math.sign(outer.signedArea)).not.toBe(Math.sign(inner.signedArea))
    // Ink area is the difference of the two discs.
    const ink = Math.abs(outer.signedArea) - Math.abs(inner.signedArea)
    const expected = Math.PI * (40 * 40 - 22 * 22)
    expect(Math.abs(ink - expected) / expected).toBeLessThan(0.02)
  })

  it('finds two loops for two separate shapes', () => {
    const image = createGray(100, 60, 255)
    for (let y = 20; y < 40; y += 1) {
      for (let x = 10; x < 30; x += 1) image.data[y * 100 + x] = 0
      for (let x = 60; x < 80; x += 1) image.data[y * 100 + x] = 0
    }
    expect(trace(image)).toHaveLength(2)
  })

  it('discards specks below the noise floor', () => {
    const image = box(100, 20, 20, 60, 60)
    // A single stray pixel should not become a contour.
    image.data[5 * 100 + 90] = 0
    expect(trace(image)).toHaveLength(1)
  })

  it('closes a shape that runs off the edge of the image', () => {
    // Ink touching the border still has to produce a closed loop.
    const image = box(50, 0, 0, 25, 50)
    const polygons = trace(image)
    expect(polygons).toHaveLength(1)
    expect(Math.abs(polygons[0].signedArea)).toBeGreaterThan(1000)
  })

  it('returns nothing for a blank image', () => {
    expect(trace(createGray(40, 40, 255))).toHaveLength(0)
  })

  it('produces rings that close on themselves', () => {
    const polygons = trace(disc(80, 40, 40, 25))
    const points = polygons[0].points
    const first = points[0]
    const last = points[points.length - 1]
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(2)
  })
})

describe('polygonArea', () => {
  it('is positive for a counter-clockwise ring in image space', () => {
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(100)
  })
})

describe('threshold tie-breaking', () => {
  it('picks the middle of a clean two-tone gap, not its edge', () => {
    // Pure black on pure white: every level between them separates the two
    // groups identically, so the answer must be the midpoint.
    const image = box(60, 20, 20, 40, 40)
    const level = otsuThreshold(image)
    expect(level).toBeGreaterThan(60)
    expect(level).toBeLessThan(200)
  })

  it('still tracks a real histogram', () => {
    // Ink at 40, paper at 210: the split belongs between them.
    const image = createGray(60, 60, 210)
    for (let y = 20; y < 40; y += 1) {
      for (let x = 20; x < 40; x += 1) image.data[y * 60 + x] = 40
    }
    const level = otsuThreshold(image)
    expect(level).toBeGreaterThan(40)
    expect(level).toBeLessThan(210)
  })
})
