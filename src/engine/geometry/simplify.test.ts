import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline, countNodes, outlineBounds } from './outline'
import { inkArea } from './intersect'
import { offsetOutline } from '@/engine/transforms/offset'
import { simplifyOutline } from './simplify'

const K = 0.5522847498307936

function circle(r: number): PathCommand[] {
  const c = K * r
  return [
    { type: 'M', x: r, y: 0 },
    { type: 'C', x1: r, y1: c, x2: c, y2: r, x: 0, y: r },
    { type: 'C', x1: -c, y1: r, x2: -r, y2: c, x: -r, y: 0 },
    { type: 'C', x1: -r, y1: -c, x2: -c, y2: -r, x: 0, y: -r },
    { type: 'C', x1: c, y1: -r, x2: r, y2: -c, x: r, y: 0 },
    { type: 'Z' },
  ]
}

describe('simplifyOutline', () => {
  it('removes the nodes that offsetting added, keeping the shape', () => {
    const outline = commandsToOutline(circle(200))
    const thick = offsetOutline(outline, 20)
    const before = countNodes(thick)
    expect(before).toBeGreaterThan(12)

    const simple = simplifyOutline(thick, { tolerance: 1 })
    const after = countNodes(simple)

    expect(after).toBeLessThan(before)
    // The shape must survive: the area of the offset circle is known.
    const expected = Math.PI * 220 * 220
    expect(Math.abs(inkArea(simple) - expected) / expected).toBeLessThan(0.01)
  })

  it('stays inside the tolerance it was given', () => {
    const outline = commandsToOutline(circle(500))
    const dense = offsetOutline(outline, 30)
    const simple = simplifyOutline(dense, { tolerance: 2 })

    const before = outlineBounds(dense)
    const after = outlineBounds(simple)
    for (const key of ['xMin', 'yMin', 'xMax', 'yMax'] as const) {
      expect(Math.abs(before[key] - after[key])).toBeLessThan(3)
    }
  })

  it('keeps deliberate corners intact', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 300, y: 0 },
      { type: 'L', x: 300, y: 300 },
      { type: 'L', x: 0, y: 300 },
      { type: 'Z' },
    ])
    const simple = simplifyOutline(outline, { tolerance: 2 })
    const bounds = outlineBounds(simple)
    expect(bounds.xMin).toBeCloseTo(0, 1)
    expect(bounds.yMin).toBeCloseTo(0, 1)
    expect(bounds.xMax).toBeCloseTo(300, 1)
    expect(bounds.yMax).toBeCloseTo(300, 1)
  })

  it('leaves an already minimal path alone', () => {
    const outline = commandsToOutline(circle(100))
    const simple = simplifyOutline(outline, { tolerance: 1 })
    // A four-arc circle cannot be expressed in fewer cubics.
    expect(countNodes(simple)).toBeLessThanOrEqual(countNodes(outline))
  })

  it('does not mutate its input', () => {
    const outline = offsetOutline(commandsToOutline(circle(150)), 12)
    const snapshot = JSON.stringify(outline)
    simplifyOutline(outline, { tolerance: 1 })
    expect(JSON.stringify(outline)).toBe(snapshot)
  })

  it('produces finite coordinates everywhere', () => {
    const simple = simplifyOutline(
      offsetOutline(commandsToOutline(circle(300)), 25),
      { tolerance: 1 },
    )
    for (const contour of simple.contours) {
      for (const node of contour.nodes) {
        expect(Number.isFinite(node.x)).toBe(true)
        expect(Number.isFinite(node.y)).toBe(true)
        for (const handle of [node.in, node.out]) {
          if (!handle) continue
          expect(Number.isFinite(handle.x)).toBe(true)
          expect(Number.isFinite(handle.y)).toBe(true)
        }
      }
    }
  })
})
