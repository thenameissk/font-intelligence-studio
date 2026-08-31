import { describe, expect, it } from 'vitest'
import { createGray, type GrayImage } from './types'
import { analyzeThreshold, inkField } from './threshold'
import { traceContours, polygonArea } from './trace'
import { vectorizePolygons } from './vectorize'
import { blurField, defaultBlurRadius } from './blur'
import { inkArea } from '@/engine/geometry/intersect'

/** Hard-edged, no antialiasing: a 1-bit scan or a screenshot. */
function aliasedDisc(size: number, r: number): GrayImage {
  const image = createGray(size, size, 255)
  const c = size / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      image.data[y * size + x] =
        Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r ? 0 : 255
    }
  }
  return image
}

function traceAt(image: GrayImage, radius: number) {
  const options = analyzeThreshold(image)
  const raw = inkField(image, options)
  const field = radius
    ? blurField(raw.field, image.width, image.height, radius)
    : raw.field
  const polygons = traceContours(field, image.width, image.height, {
    isoLevel: raw.isoLevel,
  })
  return {
    polygons,
    result: vectorizePolygons(polygons, { tolerance: 1.8 }),
  }
}

describe('blurField', () => {
  it('rescues an aliased edge from becoming a staircase of nodes', () => {
    const image = aliasedDisc(400, 160)
    const sharp = traceAt(image, 0)
    const smoothed = traceAt(image, defaultBlurRadius(image))

    // The same circle, but one is editable and the other is not.
    expect(sharp.result.nodeCount).toBeGreaterThan(100)
    expect(smoothed.result.nodeCount).toBeLessThan(30)
  })

  it('keeps the shape it smoothed', () => {
    const image = aliasedDisc(400, 160)
    const expected = Math.PI * 160 * 160
    const smoothed = traceAt(image, defaultBlurRadius(image))

    // Blurring moves a convex contour inwards slightly; at this radius that
    // has to stay under a percent or it is distorting the letter.
    const area = inkArea(smoothed.result.outline)
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.01)
  })

  it('does not shift a straight edge', () => {
    const image = createGray(200, 200, 255)
    for (let y = 0; y < 200; y += 1) {
      for (let x = 50; x < 150; x += 1) image.data[y * 200 + x] = 0
    }
    // Compared against the unblurred trace, not against the pixel indices:
    // sampling already places the boundary half a pixel in, and the claim
    // being tested is that a symmetric blur does not move it further.
    const sharpXs = traceAt(image, 0).polygons[0].points.map((p) => p.x)
    const blurredXs = traceAt(image, 2).polygons[0].points.map((p) => p.x)

    // Under a twentieth of a pixel of drift on a straight boundary.
    expect(Math.min(...blurredXs)).toBeCloseTo(Math.min(...sharpXs), 1)
    expect(Math.max(...blurredXs)).toBeCloseTo(Math.max(...sharpXs), 1)
  })

  it('leaves an already-smooth image essentially alone', () => {
    const image = createGray(300, 300, 255)
    const c = 150
    for (let y = 0; y < 300; y += 1) {
      for (let x = 0; x < 300; x += 1) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c)
        const coverage = Math.max(0, Math.min(1, 100 + 0.5 - d))
        image.data[y * 300 + x] = Math.round(255 * (1 - coverage))
      }
    }
    const sharp = traceAt(image, 0)
    const smoothed = traceAt(image, 1)
    const a = Math.abs(polygonArea(sharp.polygons[0].points))
    const b = Math.abs(polygonArea(smoothed.polygons[0].points))
    expect(Math.abs(a - b) / a).toBeLessThan(0.01)
  })

  it('scales the radius with the image', () => {
    expect(defaultBlurRadius(createGray(200, 200))).toBe(1)
    expect(defaultBlurRadius(createGray(1600, 1600))).toBe(4)
  })

  it('is a no-op below radius 1', () => {
    const field = new Float32Array([0, 1, 0, 1])
    expect(blurField(field, 2, 2, 0)).toBe(field)
  })
})
