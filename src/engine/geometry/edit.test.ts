import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import { commandsToOutline, contourSegments, outlineBounds } from './outline'
import { cubicAt } from './bezier'
import type { Segment } from '@/types/geometry'
import {
  breakContourAt,
  deleteNodes,
  hitTestOutline,
  insertNode,
  joinContours,
  moveHandle,
  moveNodes,
  setNodeSmooth,
  setSegmentKind,
} from './edit'

const K = 0.5522847498307936

function circle(r = 100): PathCommand[] {
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

/** Narrows a segment to a cubic so tests can read its control points. */
function cubic(segment: Segment): {
  from: { x: number; y: number }
  c1: { x: number; y: number }
  c2: { x: number; y: number }
  to: { x: number; y: number }
} {
  if (segment.kind !== 'cubic') throw new Error('expected a cubic segment')
  return segment
}

const square: PathCommand[] = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 100, y: 0 },
  { type: 'L', x: 100, y: 100 },
  { type: 'L', x: 0, y: 100 },
  { type: 'Z' },
]

describe('moveNodes', () => {
  it('translates anchors together with their handles', () => {
    const outline = commandsToOutline(circle())
    const id = outline.contours[0].nodes[0].id
    const moved = moveNodes(outline, [id], 10, -20)
    const node = moved.contours[0].nodes[0]
    const original = outline.contours[0].nodes[0]

    expect(node.x).toBe(original.x + 10)
    expect(node.y).toBe(original.y - 20)
    expect(node.in!.x).toBe(original.in!.x + 10)
    expect(node.out!.y).toBe(original.out!.y - 20)
  })

  it('does not mutate the input outline', () => {
    const outline = commandsToOutline(square)
    const before = JSON.stringify(outline)
    moveNodes(outline, [outline.contours[0].nodes[0].id], 50, 50)
    expect(JSON.stringify(outline)).toBe(before)
  })

  it('leaves unselected nodes alone', () => {
    const outline = commandsToOutline(square)
    const moved = moveNodes(outline, [outline.contours[0].nodes[0].id], 5, 5)
    expect(moved.contours[0].nodes[1]).toEqual(outline.contours[0].nodes[1])
  })
})

describe('insertNode', () => {
  it('splits a curve without changing its shape', () => {
    const outline = commandsToOutline(circle())
    const original = cubic(contourSegments(outline.contours[0])[0])
    const t0 = 0.4

    const { outline: after, nodeId } = insertNode(
      outline,
      { contourIndex: 0, segmentIndex: 0 },
      t0,
    )
    expect(nodeId).not.toBeNull()
    expect(after.contours[0].nodes).toHaveLength(5)

    const left = cubic(contourSegments(after.contours[0])[0])
    const right = cubic(contourSegments(after.contours[0])[1])

    // A de Casteljau split is exact: the left half re-parameterises the
    // original over [0, t0] and the right half over [t0, 1].
    for (let i = 0; i <= 20; i += 1) {
      const u = i / 20
      const onLeft = cubicAt(left.from, left.c1, left.c2, left.to, u)
      const expectedLeft = cubicAt(
        original.from,
        original.c1,
        original.c2,
        original.to,
        u * t0,
      )
      expect(onLeft.x).toBeCloseTo(expectedLeft.x, 9)
      expect(onLeft.y).toBeCloseTo(expectedLeft.y, 9)

      const onRight = cubicAt(right.from, right.c1, right.c2, right.to, u)
      const expectedRight = cubicAt(
        original.from,
        original.c1,
        original.c2,
        original.to,
        t0 + u * (1 - t0),
      )
      expect(onRight.x).toBeCloseTo(expectedRight.x, 9)
      expect(onRight.y).toBeCloseTo(expectedRight.y, 9)
    }
  })

  it('puts the new node exactly on the old curve', () => {
    const outline = commandsToOutline(circle())
    const segment = cubic(contourSegments(outline.contours[0])[0])
    const expected = cubicAt(segment.from, segment.c1, segment.c2, segment.to, 0.4)
    const { outline: after } = insertNode(
      outline,
      { contourIndex: 0, segmentIndex: 0 },
      0.4,
    )
    const inserted = after.contours[0].nodes[1]
    expect(inserted.x).toBeCloseTo(expected.x, 9)
    expect(inserted.y).toBeCloseTo(expected.y, 9)
  })

  it('splits a straight segment at the right point', () => {
    const outline = commandsToOutline(square)
    const { outline: after } = insertNode(
      outline,
      { contourIndex: 0, segmentIndex: 0 },
      0.25,
    )
    expect(after.contours[0].nodes[1].x).toBeCloseTo(25, 9)
    expect(after.contours[0].nodes[1].y).toBeCloseTo(0, 9)
  })
})

describe('deleteNodes', () => {
  it('removes a node and keeps the contour valid', () => {
    const outline = commandsToOutline(square)
    const id = outline.contours[0].nodes[2].id
    const after = deleteNodes(outline, [id])
    expect(after.contours[0].nodes).toHaveLength(3)
    expect(after.contours[0].nodes.some((n) => n.id === id)).toBe(false)
  })

  it('drops a contour that would be left degenerate', () => {
    const outline = commandsToOutline(square)
    const ids = outline.contours[0].nodes.slice(0, 3).map((n) => n.id)
    expect(deleteNodes(outline, ids).contours).toHaveLength(0)
  })
})

describe('moveHandle', () => {
  it('mirrors the opposite handle on a smooth node', () => {
    const outline = commandsToOutline(circle())
    const node = outline.contours[0].nodes[0]
    expect(node.smooth).toBe(true)
    const otherLength = Math.hypot(node.in!.x - node.x, node.in!.y - node.y)

    const after = moveHandle(outline, node.id, 'out', { x: node.x + 50, y: node.y }, {})
    const updated = after.contours[0].nodes[0]

    // The opposite handle now points the other way, with its length kept.
    expect(updated.in!.x).toBeCloseTo(node.x - otherLength, 6)
    expect(updated.in!.y).toBeCloseTo(node.y, 6)
  })

  it('breaks smoothness on request', () => {
    const outline = commandsToOutline(circle())
    const node = outline.contours[0].nodes[0]
    const after = moveHandle(
      outline,
      node.id,
      'out',
      { x: node.x + 50, y: node.y + 50 },
      { breakSmooth: true },
    )
    const updated = after.contours[0].nodes[0]
    expect(updated.smooth).toBe(false)
    expect(updated.in).toEqual(node.in)
  })
})

describe('setNodeSmooth', () => {
  it('aligns handles through the anchor', () => {
    const outline = commandsToOutline(square)
    const withCurves = setSegmentKind(
      setSegmentKind(outline, { contourIndex: 0, segmentIndex: 0 }, 'curve'),
      { contourIndex: 0, segmentIndex: 1 },
      'curve',
    )
    const id = withCurves.contours[0].nodes[1].id
    const after = setNodeSmooth(withCurves, id, true)
    const node = after.contours[0].nodes[1]

    expect(node.smooth).toBe(true)
    const inDir = Math.atan2(node.y - node.in!.y, node.x - node.in!.x)
    const outDir = Math.atan2(node.out!.y - node.y, node.out!.x - node.x)
    expect(Math.abs(inDir - outDir)).toBeLessThan(1e-6)
  })
})

describe('setSegmentKind', () => {
  it('turns a line into a curve and back', () => {
    const outline = commandsToOutline(square)
    const curved = setSegmentKind(outline, { contourIndex: 0, segmentIndex: 0 }, 'curve')
    expect(curved.contours[0].nodes[0].out).not.toBeNull()
    expect(contourSegments(curved.contours[0])[0].kind).toBe('cubic')

    const straight = setSegmentKind(curved, { contourIndex: 0, segmentIndex: 0 }, 'line')
    expect(straight.contours[0].nodes[0].out).toBeNull()
    expect(contourSegments(straight.contours[0])[0].kind).toBe('line')
  })

  it('keeps the endpoints where they were', () => {
    const outline = commandsToOutline(square)
    const curved = setSegmentKind(outline, { contourIndex: 0, segmentIndex: 0 }, 'curve')
    expect(outlineBounds(curved)).toEqual(outlineBounds(outline))
  })
})

describe('breakContourAt and joinContours', () => {
  it('opens a closed contour and closes it again', () => {
    const outline = commandsToOutline(square)
    const opened = breakContourAt(outline, outline.contours[0].nodes[1].id)
    expect(opened.contours[0].closed).toBe(false)
    expect(opened.contours[0].nodes).toHaveLength(5)

    const nodes = opened.contours[0].nodes
    const rejoined = joinContours(opened, nodes[0].id, nodes[nodes.length - 1].id)
    expect(rejoined.contours[0].closed).toBe(true)
  })

  it('merges two open contours into one', () => {
    const outline = commandsToOutline(square)
    const opened = breakContourAt(outline, outline.contours[0].nodes[1].id)
    const split = breakContourAt(opened, opened.contours[0].nodes[2].id)
    expect(split.contours).toHaveLength(2)

    const merged = joinContours(
      split,
      split.contours[0].nodes[split.contours[0].nodes.length - 1].id,
      split.contours[1].nodes[0].id,
    )
    expect(merged.contours).toHaveLength(1)
  })
})

describe('hitTestOutline', () => {
  it('finds the nearest point on a curve', () => {
    const outline = commandsToOutline(circle(100))
    const hit = hitTestOutline(outline, { x: 140, y: 0 })
    expect(hit).not.toBeNull()
    expect(hit!.point.x).toBeCloseTo(100, 1)
    expect(hit!.point.y).toBeCloseTo(0, 1)
    expect(hit!.distance).toBeCloseTo(40, 1)
  })

  it('respects the distance limit', () => {
    const outline = commandsToOutline(circle(100))
    expect(hitTestOutline(outline, { x: 500, y: 500 }, 20)).toBeNull()
  })
})
