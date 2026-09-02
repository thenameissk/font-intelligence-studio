import { describe, expect, it } from 'vitest'
import type { Point } from '@/types/geometry'
import type { ResolvedGlyph } from '@/types/font'
import { commandsToOutline, outlineBounds } from '@/engine/geometry/outline'
import { ORIGIN_MODE, resolveOrigin, scaleGlyph } from './glyphTransforms'

function makeGlyph(points: readonly Point[], advanceWidth = 500): ResolvedGlyph {
  const outline = commandsToOutline([
    { type: 'M', x: points[0].x, y: points[0].y },
    ...points.slice(1).map((p) => ({ type: 'L' as const, x: p.x, y: p.y })),
    { type: 'Z' as const },
  ])
  const bounds = outlineBounds(outline)
  return {
    index: 1,
    name: 'test',
    unicode: null,
    unicodes: [],
    advanceWidth,
    outline,
    components: [],
    bounds,
    leftSideBearing: bounds.xMin,
    rightSideBearing: advanceWidth - bounds.xMax,
    isComposite: false,
    isEmpty: false,
    modified: false,
  }
}

describe('the nine-point reference grid', () => {
  const bounds = { xMin: 100, yMin: -50, xMax: 500, yMax: 700 }

  it('anchors each point on the ink box', () => {
    expect(resolveOrigin(bounds, ORIGIN_MODE.TopLeft)).toEqual({ x: 100, y: 700 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.TopCenter)).toEqual({ x: 300, y: 700 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.TopRight)).toEqual({ x: 500, y: 700 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.MiddleLeft)).toEqual({ x: 100, y: 325 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.Center)).toEqual({ x: 300, y: 325 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.MiddleRight)).toEqual({ x: 500, y: 325 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.BottomLeft)).toEqual({ x: 100, y: -50 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.BottomCenter)).toEqual({ x: 300, y: -50 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.BottomRight)).toEqual({ x: 500, y: -50 })
  })

  it('keeps the typographic origins distinct from the geometric ones', () => {
    // The baseline is y = 0 whether or not the ink reaches it, which is what
    // keeps a scaled letter registered with the rest of the alphabet. The
    // bottom of this ink box is a different point, 50 units below the line.
    expect(resolveOrigin(bounds, ORIGIN_MODE.Baseline)).toEqual({ x: 0, y: 0 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.CenterBaseline)).toEqual({ x: 300, y: 0 })
    expect(resolveOrigin(bounds, ORIGIN_MODE.BottomCenter)).not.toEqual(
      resolveOrigin(bounds, ORIGIN_MODE.CenterBaseline),
    )
  })

  it('holds the chosen corner still while the rest moves', () => {
    const glyph = makeGlyph([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 800 },
      { x: 0, y: 800 },
    ])

    const edit = scaleGlyph(glyph, 0.5, 0.5, { origin: ORIGIN_MODE.TopRight })
    const box = outlineBounds(edit.outline!)

    // The top-right corner is the fixed point, so it stays exactly where it was.
    expect(box.xMax).toBeCloseTo(400, 6)
    expect(box.yMax).toBeCloseTo(800, 6)
    expect(box.xMin).toBeCloseTo(200, 6)
    expect(box.yMin).toBeCloseTo(400, 6)
  })

  it('lifts a descending letter off the baseline only when asked to', () => {
    // A letter with a descender, scaled about the baseline, keeps sitting on
    // the line; scaled about the middle of its ink, it does not.
    const glyph = makeGlyph([
      { x: 0, y: -200 },
      { x: 400, y: -200 },
      { x: 400, y: 600 },
      { x: 0, y: 600 },
    ])

    const onLine = outlineBounds(
      scaleGlyph(glyph, 1, 0.5, { origin: ORIGIN_MODE.Baseline }).outline!,
    )
    expect(onLine.yMin).toBeCloseTo(-100, 6)
    expect(onLine.yMax).toBeCloseTo(300, 6)

    const floating = outlineBounds(
      scaleGlyph(glyph, 1, 0.5, { origin: ORIGIN_MODE.Center }).outline!,
    )
    expect(floating.yMin).toBeCloseTo(0, 6)
  })
})
