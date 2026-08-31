import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline, contourSegments, outlineBounds } from '@/engine/geometry/outline'
import { inkArea } from '@/engine/geometry/intersect'
import { findCorners, roundCorners } from './roundCorners'

const square = (size = 200): PathCommand[] => [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: size, y: 0 },
  { type: 'L', x: size, y: size },
  { type: 'L', x: 0, y: size },
  { type: 'Z' },
]

describe('findCorners', () => {
  it('finds all four corners of a square', () => {
    const corners = findCorners(commandsToOutline(square()))
    expect(corners).toHaveLength(4)
    for (const corner of corners) expect(corner.angle).toBeCloseTo(90, 6)
  })

  it('finds no corners on a smooth circle', () => {
    const K = 0.5522847498307936 * 100
    const outline = commandsToOutline([
      { type: 'M', x: 100, y: 0 },
      { type: 'C', x1: 100, y1: K, x2: K, y2: 100, x: 0, y: 100 },
      { type: 'C', x1: -K, y1: 100, x2: -100, y2: K, x: -100, y: 0 },
      { type: 'C', x1: -100, y1: -K, x2: -K, y2: -100, x: 0, y: -100 },
      { type: 'C', x1: K, y1: -100, x2: 100, y2: -K, x: 100, y: 0 },
      { type: 'Z' },
    ])
    expect(findCorners(outline)).toHaveLength(0)
  })
})

describe('roundCorners', () => {
  it('replaces each corner with two nodes joined by an arc', () => {
    const outline = commandsToOutline(square())
    const rounded = roundCorners(outline, { radius: 20 })
    // Four corners become eight nodes.
    expect(rounded.contours[0].nodes).toHaveLength(8)
    expect(findCorners(rounded)).toHaveLength(0)
  })

  it('keeps the outline inside its original bounds', () => {
    const outline = commandsToOutline(square())
    const rounded = roundCorners(outline, { radius: 30 })
    const before = outlineBounds(outline)
    const after = outlineBounds(rounded)
    expect(after.xMin).toBeGreaterThanOrEqual(before.xMin - 1e-6)
    expect(after.xMax).toBeLessThanOrEqual(before.xMax + 1e-6)
    expect(after.yMin).toBeGreaterThanOrEqual(before.yMin - 1e-6)
    expect(after.yMax).toBeLessThanOrEqual(before.yMax + 1e-6)
  })

  it('removes exactly the area the fillets cut away', () => {
    const size = 200
    const radius = 25
    const outline = commandsToOutline(square(size))
    const rounded = roundCorners(outline, { radius })

    // Each 90 degree corner loses r^2 - (pi/4)r^2 of area.
    const lostPerCorner = radius * radius - (Math.PI / 4) * radius * radius
    const expected = size * size - 4 * lostPerCorner
    expect(Math.abs(inkArea(rounded) - expected) / expected).toBeLessThan(0.002)
  })

  it('produces a fillet tangent to both edges', () => {
    const outline = commandsToOutline(square(200))
    const rounded = roundCorners(outline, { radius: 20 })
    const nodes = rounded.contours[0].nodes
    // Every fillet endpoint sits 20 units back from its corner along an edge.
    const onEdge = nodes.filter(
      (n) =>
        Math.abs(n.x) < 1e-6 ||
        Math.abs(n.x - 200) < 1e-6 ||
        Math.abs(n.y) < 1e-6 ||
        Math.abs(n.y - 200) < 1e-6,
    )
    expect(onEdge).toHaveLength(8)
  })

  it('clamps the radius so a fillet cannot swallow its neighbours', () => {
    const outline = commandsToOutline(square(100))
    // A 500 unit radius is far larger than the shape itself.
    const rounded = roundCorners(outline, { radius: 500 })
    const bounds = outlineBounds(rounded)
    expect(bounds.xMax - bounds.xMin).toBeLessThanOrEqual(100 + 1e-6)
    expect(inkArea(rounded)).toBeGreaterThan(0)
  })

  it('leaves shallow corners alone', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 200, y: 5 },
      { type: 'L', x: 200, y: 100 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
    ])
    // The bend at (100, 0) turns by about 3 degrees.
    const rounded = roundCorners(outline, { radius: 10, minAngle: 25 })
    const stillThere = rounded.contours[0].nodes.some(
      (n) => Math.abs(n.x - 100) < 1e-6 && Math.abs(n.y) < 1e-6,
    )
    expect(stillThere).toBe(true)
  })

  it('can round only the selected nodes', () => {
    const outline = commandsToOutline(square())
    const first = outline.contours[0].nodes[0].id
    const rounded = roundCorners(outline, {
      radius: 20,
      nodeIds: new Set([first]),
    })
    expect(rounded.contours[0].nodes).toHaveLength(5)
    expect(findCorners(rounded)).toHaveLength(3)
  })

  it('does not mutate its input', () => {
    const outline = commandsToOutline(square())
    const snapshot = JSON.stringify(outline)
    roundCorners(outline, { radius: 20 })
    expect(JSON.stringify(outline)).toBe(snapshot)
  })

  it('keeps every segment well formed', () => {
    const rounded = roundCorners(commandsToOutline(square()), { radius: 20 })
    for (const segment of contourSegments(rounded.contours[0])) {
      const points =
        segment.kind === 'cubic'
          ? [segment.from, segment.c1, segment.c2, segment.to]
          : [segment.from, segment.to]
      for (const point of points) {
        expect(Number.isFinite(point.x)).toBe(true)
        expect(Number.isFinite(point.y)).toBe(true)
      }
    }
  })
})
