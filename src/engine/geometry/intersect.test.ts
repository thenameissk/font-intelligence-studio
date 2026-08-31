import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline } from './outline'
import {
  inkArea,
  inkRunsAtX,
  inkRunsAtY,
  isPointInside,
  solveCubic,
} from './intersect'

const K = 0.5522847498307936

function circle(r: number, cx = 0, cy = 0, ccw = true): PathCommand[] {
  const c = K * r
  const forward: PathCommand[] = [
    { type: 'M', x: cx + r, y: cy },
    { type: 'C', x1: cx + r, y1: cy + c, x2: cx + c, y2: cy + r, x: cx, y: cy + r },
    { type: 'C', x1: cx - c, y1: cy + r, x2: cx - r, y2: cy + c, x: cx - r, y: cy },
    { type: 'C', x1: cx - r, y1: cy - c, x2: cx - c, y2: cy - r, x: cx, y: cy - r },
    { type: 'C', x1: cx + c, y1: cy - r, x2: cx + r, y2: cy - c, x: cx + r, y: cy },
    { type: 'Z' },
  ]
  if (ccw) return forward
  return [
    { type: 'M', x: cx + r, y: cy },
    { type: 'C', x1: cx + r, y1: cy - c, x2: cx + c, y2: cy - r, x: cx, y: cy - r },
    { type: 'C', x1: cx - c, y1: cy - r, x2: cx - r, y2: cy - c, x: cx - r, y: cy },
    { type: 'C', x1: cx - r, y1: cy + c, x2: cx - c, y2: cy + r, x: cx, y: cy + r },
    { type: 'C', x1: cx + c, y1: cy + r, x2: cx + r, y2: cy + c, x: cx + r, y: cy },
    { type: 'Z' },
  ]
}

function rect(x0: number, y0: number, x1: number, y1: number): PathCommand[] {
  return [
    { type: 'M', x: x0, y: y0 },
    { type: 'L', x: x1, y: y0 },
    { type: 'L', x: x1, y: y1 },
    { type: 'L', x: x0, y: y1 },
    { type: 'Z' },
  ]
}

describe('solveCubic', () => {
  it('finds three distinct real roots', () => {
    // (t-1)(t-2)(t-3) = t^3 - 6t^2 + 11t - 6
    const roots = solveCubic(1, -6, 11, -6).sort((a, b) => a - b)
    expect(roots).toHaveLength(3)
    expect(roots[0]).toBeCloseTo(1, 9)
    expect(roots[1]).toBeCloseTo(2, 9)
    expect(roots[2]).toBeCloseTo(3, 9)
  })

  it('finds a single real root', () => {
    // t^3 + t + 1 has one real root near -0.6823
    const roots = solveCubic(1, 0, 1, 1)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(-0.6823278, 6)
  })

  it('degrades to quadratic and linear', () => {
    expect(solveCubic(0, 1, -3, 2).sort((a, b) => a - b)).toEqual([1, 2])
    expect(solveCubic(0, 0, 2, -4)).toEqual([2])
  })
})

describe('inkRunsAtY', () => {
  it('measures the width of a rectangle', () => {
    const outline = commandsToOutline(rect(100, 0, 300, 700))
    const runs = inkRunsAtY(outline, 350)
    expect(runs).toHaveLength(1)
    expect(runs[0].start).toBeCloseTo(100, 9)
    expect(runs[0].width).toBeCloseTo(200, 9)
  })

  it('measures both stems of a counter, whichever way the counter winds', () => {
    // An "O": outer circle r=100, inner counter r=60, opposite direction.
    const outline = commandsToOutline([...circle(100), ...circle(60, 0, 0, false)])
    const runs = inkRunsAtY(outline, 0)
    expect(runs).toHaveLength(2)
    expect(runs[0].width).toBeCloseTo(40, 3)
    expect(runs[1].width).toBeCloseTo(40, 3)
    expect(runs[0].start).toBeCloseTo(-100, 3)
    expect(runs[1].end).toBeCloseTo(100, 3)
  })

  it('returns nothing above the outline', () => {
    const outline = commandsToOutline(rect(0, 0, 100, 100))
    expect(inkRunsAtY(outline, 500)).toHaveLength(0)
  })

  it('measures a horizontal stroke with a vertical scanline', () => {
    const outline = commandsToOutline([...circle(100), ...circle(60, 0, 0, false)])
    const runs = inkRunsAtX(outline, 0)
    expect(runs).toHaveLength(2)
    expect(runs[0].width).toBeCloseTo(40, 3)
    expect(runs[1].width).toBeCloseTo(40, 3)
  })
})

describe('isPointInside', () => {
  it('respects the non-zero winding rule through a counter', () => {
    const outline = commandsToOutline([...circle(100), ...circle(60, 0, 0, false)])
    expect(isPointInside(outline, { x: 0, y: 0 })).toBe(false) // in the counter
    expect(isPointInside(outline, { x: 80, y: 0 })).toBe(true) // in the stem
    expect(isPointInside(outline, { x: 150, y: 0 })).toBe(false) // outside
  })
})

describe('inkArea', () => {
  it('subtracts counters from the outer contour', () => {
    const outline = commandsToOutline([...circle(100), ...circle(60, 0, 0, false)])
    const expected = Math.PI * (100 * 100 - 60 * 60)
    expect(Math.abs(inkArea(outline) - expected) / expected).toBeLessThan(1e-3)
  })
})
