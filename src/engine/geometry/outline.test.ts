import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import {
  commandsToOutline,
  contourDirection,
  contourSegments,
  contourSignedArea,
  outlineBounds,
  outlineToCommands,
  reverseContour,
} from './outline'
import { flattenCubic } from './bezier'
import type { Contour } from '@/types/geometry'

/** Independent area check: flatten everything and use the shoelace formula. */
function flattenedArea(contour: Contour): number {
  const points = [contour.nodes[0]].map((n) => ({ x: n.x, y: n.y }))
  for (const segment of contourSegments(contour)) {
    if (segment.kind === 'line') {
      points.push(segment.to)
    } else {
      points.push(
        ...flattenCubic(segment.from, segment.c1, segment.c2, segment.to, 0.001),
      )
    }
  }
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += (a.x * b.y - b.x * a.y) / 2
  }
  return area
}

const K = 0.5522847498307936

/** Counter-clockwise circle of radius r centred at the origin. */
function circleCommands(r: number): PathCommand[] {
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

describe('commandsToOutline', () => {
  it('merges the duplicated closing point into the start node', () => {
    const outline = commandsToOutline(circleCommands(100))
    expect(outline.contours).toHaveLength(1)
    const contour = outline.contours[0]
    expect(contour.closed).toBe(true)
    expect(contour.nodes).toHaveLength(4)
    // The closing curve's second control point becomes the start node's `in`.
    expect(contour.nodes[0].in).toEqual({ x: 100, y: -K * 100 })
    expect(contour.nodes[0].out).toEqual({ x: 100, y: K * 100 })
  })

  it('marks collinear handles as smooth', () => {
    const outline = commandsToOutline(circleCommands(100))
    expect(outline.contours[0].nodes.every((n) => n.smooth)).toBe(true)
  })

  it('converts quadratics to exactly equivalent cubics', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 50, y1: 100, x: 100, y: 0 },
      { type: 'Z' },
    ])
    const [contour] = outline.contours
    expect(contour.nodes[0].out?.x).toBeCloseTo(100 / 3, 10)
    expect(contour.nodes[0].out?.y).toBeCloseTo(200 / 3, 10)
    expect(contour.nodes[1].in?.x).toBeCloseTo(200 / 3, 10)
    expect(contour.nodes[1].in?.y).toBeCloseTo(200 / 3, 10)
  })

  it('keeps a straight closing segment when the path does not return home', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 100, y: 100 },
      { type: 'Z' },
    ])
    expect(outline.contours[0].nodes).toHaveLength(3)
  })
})

describe('outlineToCommands', () => {
  it('round-trips a circle back to the same geometry', () => {
    const original = circleCommands(100)
    const roundTripped = outlineToCommands(commandsToOutline(original))
    expect(roundTripped).toEqual(original)
  })

  it('round-trips a polygon', () => {
    const original: PathCommand[] = [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 100, y: 100 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
    ]
    expect(outlineToCommands(commandsToOutline(original))).toEqual(original)
  })
})

describe('contourSignedArea', () => {
  it('matches the area of a circle', () => {
    const outline = commandsToOutline(circleCommands(100))
    const area = contourSignedArea(outline.contours[0])
    // A 4-arc Bezier circle is within ~0.03% of a true circle.
    const exact = Math.PI * 100 * 100
    expect(area).toBeGreaterThan(0)
    expect(Math.abs(area - exact) / exact).toBeLessThan(5e-4)
  })

  it('agrees with dense flattening', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 10, y: 20 },
      { type: 'C', x1: 200, y1: 400, x2: -50, y2: 300, x: 180, y: 60 },
      { type: 'L', x: 40, y: -30 },
      { type: 'C', x1: 0, y1: 0, x2: 5, y2: 5, x: 10, y: 20 },
      { type: 'Z' },
    ])
    const contour = outline.contours[0]
    const exact = contourSignedArea(contour)
    const approx = flattenedArea(contour)
    expect(Math.abs(exact - approx) / Math.abs(approx)).toBeLessThan(1e-4)
  })

  it('is positive counter-clockwise and negative clockwise', () => {
    const square = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 100, y: 100 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
    ]).contours[0]
    expect(contourSignedArea(square)).toBe(10000)
    expect(contourDirection(square)).toBe('ccw')
    expect(contourDirection(reverseContour(square))).toBe('cw')
  })
})

describe('reverseContour', () => {
  it('preserves geometry while flipping direction', () => {
    const contour = commandsToOutline(circleCommands(100)).contours[0]
    const reversed = reverseContour(contour)
    expect(reversed.nodes).toHaveLength(contour.nodes.length)
    expect(contourSignedArea(reversed)).toBeCloseTo(-contourSignedArea(contour), 6)
    expect(outlineBounds({ contours: [reversed] })).toEqual(
      outlineBounds({ contours: [contour] }),
    )
  })
})

describe('outlineBounds', () => {
  it('accounts for curve extrema, not just anchors', () => {
    const outline = commandsToOutline([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 0, y1: 100, x2: 100, y2: 100, x: 100, y: 0 },
      { type: 'Z' },
    ])
    const bounds = outlineBounds(outline)
    expect(bounds.xMin).toBe(0)
    expect(bounds.xMax).toBe(100)
    expect(bounds.yMin).toBe(0)
    expect(bounds.yMax).toBeCloseTo(75, 6)
  })
})
