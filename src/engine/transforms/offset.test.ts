import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline, contourSignedArea, outlineBounds } from '@/engine/geometry/outline'
import { inkArea, inkRunsAtY } from '@/engine/geometry/intersect'
import { offsetOutline } from './offset'

const K = 0.5522847498307936

function circle(r: number, ccw = true): PathCommand[] {
  const c = K * r
  return ccw
    ? [
        { type: 'M', x: r, y: 0 },
        { type: 'C', x1: r, y1: c, x2: c, y2: r, x: 0, y: r },
        { type: 'C', x1: -c, y1: r, x2: -r, y2: c, x: -r, y: 0 },
        { type: 'C', x1: -r, y1: -c, x2: -c, y2: -r, x: 0, y: -r },
        { type: 'C', x1: c, y1: -r, x2: r, y2: -c, x: r, y: 0 },
        { type: 'Z' },
      ]
    : [
        { type: 'M', x: r, y: 0 },
        { type: 'C', x1: r, y1: -c, x2: c, y2: -r, x: 0, y: -r },
        { type: 'C', x1: -c, y1: -r, x2: -r, y2: -c, x: -r, y: 0 },
        { type: 'C', x1: -r, y1: c, x2: -c, y2: r, x: 0, y: r },
        { type: 'C', x1: c, y1: r, x2: r, y2: c, x: r, y: 0 },
        { type: 'Z' },
      ]
}

describe('offsetOutline', () => {
  it('grows a counter-clockwise circle to the expected radius', () => {
    const outline = commandsToOutline(circle(100))
    const grown = offsetOutline(outline, 10)
    const bounds = outlineBounds(grown)

    expect(bounds.xMax).toBeCloseTo(110, 1)
    expect(bounds.xMin).toBeCloseTo(-110, 1)
    expect(bounds.yMax).toBeCloseTo(110, 1)
  })

  it('grows a clockwise circle outward too', () => {
    // Winding must not decide whether ink grows -- only which way is "out".
    const outline = commandsToOutline(circle(100, false))
    expect(contourSignedArea(outline.contours[0])).toBeLessThan(0)
    const bounds = outlineBounds(offsetOutline(outline, 10))
    expect(bounds.xMax).toBeCloseTo(110, 1)
  })

  it('shrinks with a negative distance', () => {
    const outline = commandsToOutline(circle(100))
    const bounds = outlineBounds(offsetOutline(outline, -15))
    expect(bounds.xMax).toBeCloseTo(85, 1)
  })

  it('matches the analytic area of an offset circle', () => {
    const outline = commandsToOutline(circle(200))
    const grown = offsetOutline(outline, 20)
    const expected = Math.PI * 220 * 220
    expect(Math.abs(inkArea(grown) - expected) / expected).toBeLessThan(0.005)
  })

  it('thickens a ring by growing the outside and shrinking the counter', () => {
    // An 'O': outer contour counter-clockwise, counter clockwise.
    const outline = commandsToOutline([...circle(100), ...circle(60, false)])
    const before = inkRunsAtY(outline, 0)
    expect(before).toHaveLength(2)
    expect(before[0].width).toBeCloseTo(40, 1)

    const bolder = offsetOutline(outline, 8)
    const after = inkRunsAtY(bolder, 0)
    expect(after).toHaveLength(2)
    // Both sides gain 8 units, so the stroke gains 16.
    expect(after[0].width).toBeCloseTo(56, 0)
    expect(after[1].width).toBeCloseTo(56, 0)
  })

  it('mitres the corners of a rectangle', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 200, y: 0 },
      { type: 'L', x: 200, y: 100 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
    ])
    const grown = offsetOutline(outline, 10)
    const bounds = outlineBounds(grown)
    // A mitred offset of a rectangle is a larger rectangle.
    expect(bounds.xMin).toBeCloseTo(-10, 6)
    expect(bounds.yMin).toBeCloseTo(-10, 6)
    expect(bounds.xMax).toBeCloseTo(210, 6)
    expect(bounds.yMax).toBeCloseTo(110, 6)
  })

  it('leaves the outline untouched for a zero distance', () => {
    const outline = commandsToOutline(circle(100))
    expect(offsetOutline(outline, 0)).toBe(outline)
  })

  it('does not mutate its input', () => {
    const outline = commandsToOutline(circle(100))
    const snapshot = JSON.stringify(outline)
    offsetOutline(outline, 25)
    expect(JSON.stringify(outline)).toBe(snapshot)
  })
})
