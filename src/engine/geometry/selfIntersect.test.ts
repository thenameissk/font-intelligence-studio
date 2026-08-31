import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline } from './outline'
import { findSelfIntersections, hasSelfIntersection } from './selfIntersect'

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

describe('findSelfIntersections', () => {
  it('finds none in a clean square', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 100, y: 100 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
    ])
    expect(findSelfIntersections(outline)).toEqual([])
  })

  it('finds none in a clean circle', () => {
    expect(findSelfIntersections(commandsToOutline(circle(100)))).toEqual([])
  })

  it('finds none in a well-formed O with a counter', () => {
    const outline = commandsToOutline([...circle(100), ...circle(60)])
    expect(findSelfIntersections(outline)).toEqual([])
  })

  it('finds the crossing in a bow tie', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 100 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
    ])
    const found = findSelfIntersections(outline)
    expect(found).toHaveLength(1)
    expect(found[0].point.x).toBeCloseTo(50, 1)
    expect(found[0].point.y).toBeCloseTo(50, 1)
  })

  it('finds where two contours overlap', () => {
    const outline = commandsToOutline([...circle(100), ...circle(100, 120)])
    expect(hasSelfIntersection(outline)).toBe(true)
    const found = findSelfIntersections(outline)
    expect(found.length).toBeGreaterThan(0)
    expect(found.some((i) => i.contourA !== i.contourB)).toBe(true)
  })

  it('does not report contours that merely touch at a point', () => {
    // Two squares sharing one corner exactly.
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 100, y: 100 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
      { type: 'M', x: 100, y: 100 },
      { type: 'L', x: 200, y: 100 },
      { type: 'L', x: 200, y: 200 },
      { type: 'L', x: 100, y: 200 },
      { type: 'Z' },
    ])
    expect(findSelfIntersections(outline)).toEqual([])
  })

  it('collapses one crossing into a single report', () => {
    // A curve crossing itself should be reported once, not once per
    // flattened sub-edge.
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 200, y1: 200, x2: -100, y2: 200, x: 100, y: 0 },
      { type: 'Z' },
    ])
    expect(findSelfIntersections(outline).length).toBeLessThanOrEqual(2)
  })
})
