import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline, outlineBounds } from './outline'
import { inkArea } from './intersect'
import { hasOverlap, removeOverlap } from './boolean'

function rect(x0: number, y0: number, x1: number, y1: number): PathCommand[] {
  return [
    { type: 'M', x: x0, y: y0 },
    { type: 'L', x: x1, y: y0 },
    { type: 'L', x: x1, y: y1 },
    { type: 'L', x: x0, y: y1 },
    { type: 'Z' },
  ]
}

const K = 0.5522847498307936
function circle(r: number, cx = 0, cy = 0): PathCommand[] {
  const c = K * r
  return [
    { type: 'M', x: cx + r, y: cy },
    { type: 'C', x1: cx + r, y1: cy + c, x2: cx + c, y2: cy + r, x: cx, y: cy + r },
    { type: 'C', x1: cx - c, y1: cy + r, x2: cx - r, y2: cy + c, x: cx - r, y: cy },
    { type: 'C', x1: cx - r, y1: cy - c, x2: cx - c, y2: cy - r, x: cx, y: cy - r },
    { type: 'C', x1: cx + c, y1: cy - r, x2: cx + r, y2: cy - c, x: cx + r, y: cy },
    { type: 'Z' },
  ]
}

describe('hasOverlap', () => {
  it('is false for separate shapes', () => {
    const outline = commandsToOutline([
      ...rect(0, 0, 100, 100),
      ...rect(200, 0, 300, 100),
    ])
    expect(hasOverlap(outline)).toBe(false)
  })

  it('is false for a clean O', () => {
    expect(hasOverlap(commandsToOutline([...circle(100), ...circle(60)]))).toBe(false)
  })

  it('is true for two overlapping squares', () => {
    const outline = commandsToOutline([
      ...rect(0, 0, 100, 100),
      ...rect(50, 50, 150, 150),
    ])
    expect(hasOverlap(outline)).toBe(true)
  })
})

describe('removeOverlap', () => {
  it('unites two overlapping squares into one contour', () => {
    const outline = commandsToOutline([
      ...rect(0, 0, 100, 100),
      ...rect(50, 50, 150, 150),
    ])
    const united = removeOverlap(outline)

    expect(united.contours).toHaveLength(1)
    // Two 100x100 squares sharing a 50x50 corner: 10000 + 10000 - 2500.
    expect(Math.abs(inkArea(united) - 17500) / 17500).toBeLessThan(0.01)
    expect(outlineBounds(united)).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 150,
      yMax: 150,
    })
  })

  it('unites two overlapping circles', () => {
    // Circles of radius 100 whose centres are 100 apart.
    const outline = commandsToOutline([...circle(100, 0, 0), ...circle(100, 100, 0)])
    const united = removeOverlap(outline)

    const r = 100
    const d = 100
    // Area of a two-circle union, analytically.
    const lensArea =
      2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d)
    const expected = 2 * Math.PI * r * r - lensArea

    expect(Math.abs(inkArea(united) - expected) / expected).toBeLessThan(0.02)
  })

  it('leaves a non-overlapping outline exactly as it was', () => {
    const outline = commandsToOutline([...circle(100), ...circle(60)])
    expect(removeOverlap(outline)).toBe(outline)
  })

  it('leaves separate shapes alone', () => {
    const outline = commandsToOutline([
      ...rect(0, 0, 100, 100),
      ...rect(200, 0, 300, 100),
    ])
    expect(removeOverlap(outline)).toBe(outline)
  })

  it('does not mutate its input', () => {
    const outline = commandsToOutline([
      ...rect(0, 0, 100, 100),
      ...rect(50, 50, 150, 150),
    ])
    const snapshot = JSON.stringify(outline)
    removeOverlap(outline)
    expect(JSON.stringify(outline)).toBe(snapshot)
  })

  it('produces an outline with no remaining overlap', () => {
    const outline = commandsToOutline([
      ...rect(0, 0, 100, 100),
      ...rect(50, 50, 150, 150),
    ])
    const united = removeOverlap(outline)
    expect(hasOverlap(united)).toBe(false)
  })

  it('keeps every coordinate finite', () => {
    const united = removeOverlap(
      commandsToOutline([...circle(100, 0, 0), ...circle(100, 90, 40)]),
    )
    for (const contour of united.contours) {
      for (const node of contour.nodes) {
        expect(Number.isFinite(node.x)).toBe(true)
        expect(Number.isFinite(node.y)).toBe(true)
      }
    }
  })
})
