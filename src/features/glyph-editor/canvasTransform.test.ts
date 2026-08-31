import { describe, expect, it } from 'vitest'
import { fitView, toFont, toScreen, zoomAround } from './canvasTransform'

const view = { zoom: 0.5, originX: 100, originY: 400 }

describe('view transform', () => {
  it('maps the font origin to the screen origin point', () => {
    expect(toScreen(view, { x: 0, y: 0 })).toEqual({ x: 100, y: 400 })
  })

  it('flips the y axis', () => {
    // 200 units above the baseline is 100px up the screen.
    expect(toScreen(view, { x: 0, y: 200 })).toEqual({ x: 100, y: 300 })
  })

  it('round-trips through font space', () => {
    const point = { x: 137, y: -42 }
    const back = toFont(view, toScreen(view, point))
    expect(back.x).toBeCloseTo(point.x, 9)
    expect(back.y).toBeCloseTo(point.y, 9)
  })
})

describe('zoomAround', () => {
  it('keeps the anchor point stationary', () => {
    const anchor = { x: 320, y: 210 }
    const before = toFont(view, anchor)
    const zoomed = zoomAround(view, anchor, 2.5, { min: 0.01, max: 100 })
    const after = toFont(zoomed, anchor)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('respects zoom limits', () => {
    expect(zoomAround(view, { x: 0, y: 0 }, 1000, { min: 0.1, max: 4 }).zoom).toBe(4)
    expect(zoomAround(view, { x: 0, y: 0 }, 0.0001, { min: 0.1, max: 4 }).zoom).toBe(0.1)
  })
})

describe('fitView', () => {
  it('frames the glyph inside the viewport', () => {
    const fitted = fitView({
      width: 800,
      height: 600,
      bounds: { xMin: 20, yMin: 0, xMax: 700, yMax: 700 },
      advanceWidth: 720,
      ascender: 750,
      descender: -200,
      unitsPerEm: 1000,
      padding: 40,
    })
    const topLeft = toScreen(fitted, { x: 0, y: 750 })
    const bottomRight = toScreen(fitted, { x: 720, y: -200 })
    expect(topLeft.y).toBeGreaterThanOrEqual(0)
    expect(bottomRight.y).toBeLessThanOrEqual(600)
    expect(topLeft.x).toBeGreaterThanOrEqual(0)
    expect(bottomRight.x).toBeLessThanOrEqual(800)
  })

  it('handles an empty glyph without collapsing', () => {
    const fitted = fitView({
      width: 800,
      height: 600,
      bounds: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      advanceWidth: 0,
      ascender: 800,
      descender: -200,
      unitsPerEm: 1000,
    })
    expect(Number.isFinite(fitted.zoom)).toBe(true)
    expect(fitted.zoom).toBeGreaterThan(0)
  })
})
