import { describe, expect, it } from 'vitest'
import type { PathCommand } from 'opentype.js'
import type { ResolvedGlyph } from '@/types/font'
import { commandsToOutline, outlineBounds } from '@/engine/geometry/outline'
import { applyTransformSpec } from './applySpec'
import { describeScope, metricBands, resolveScope, WHOLE_GLYPH } from './scope'

/** A 'p': bowl at x-height, stem descending below the baseline. */
const P: PathCommand[] = [
  { type: 'M', x: 0, y: -200 },
  { type: 'L', x: 100, y: -200 },
  { type: 'L', x: 100, y: 500 },
  { type: 'L', x: 0, y: 500 },
  { type: 'Z' },
  { type: 'M', x: 140, y: 0 },
  { type: 'L', x: 400, y: 0 },
  { type: 'L', x: 400, y: 500 },
  { type: 'L', x: 140, y: 500 },
  { type: 'Z' },
]

function glyphOf(commands: PathCommand[]): ResolvedGlyph {
  const outline = commandsToOutline(commands)
  const bounds = outlineBounds(outline)
  return {
    index: 0, name: 'p', unicode: 0x70, unicodes: [0x70],
    advanceWidth: 460, outline, components: [], bounds,
    leftSideBearing: bounds.xMin, rightSideBearing: 460 - bounds.xMax,
    isComposite: false, isEmpty: false, modified: false,
  }
}

describe('resolveScope', () => {
  const glyph = glyphOf(P)

  it('takes everything for the whole glyph', () => {
    const resolved = resolveScope(glyph.outline, WHOLE_GLYPH)
    expect(resolved.isWhole).toBe(true)
    expect(resolved.nodeIds).toHaveLength(8)
  })

  it('takes only the anchors below the baseline', () => {
    const resolved = resolveScope(glyph.outline, {
      kind: 'band',
      from: -200,
      to: -1,
    })
    expect(resolved.nodeIds).toHaveLength(2)
    expect(resolved.isWhole).toBe(false)
  })

  it('takes a named contour', () => {
    const bowl = glyph.outline.contours[1]
    const resolved = resolveScope(glyph.outline, {
      kind: 'contours',
      contourIds: [bowl.id],
    })
    expect(resolved.nodeIds).toHaveLength(4)
    expect(resolved.bounds?.xMin).toBe(140)
  })

  it('takes anchors inside a region', () => {
    const resolved = resolveScope(glyph.outline, {
      kind: 'region',
      rect: { xMin: 130, yMin: -50, xMax: 500, yMax: 600 },
    })
    expect(resolved.nodeIds).toHaveLength(4)
  })

  it('reports an empty scope rather than silently doing nothing', () => {
    const resolved = resolveScope(glyph.outline, {
      kind: 'region',
      rect: { xMin: 9000, yMin: 9000, xMax: 9999, yMax: 9999 },
    })
    expect(resolved.nodeIds).toHaveLength(0)
    expect(describeScope({ kind: 'region', rect: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 } }, resolved))
      .toMatch(/nothing/)
  })

  it('notices when a partial scope happens to cover everything', () => {
    const resolved = resolveScope(glyph.outline, {
      kind: 'band',
      from: -1000,
      to: 1000,
    })
    expect(resolved.isWhole).toBe(true)
  })
})

describe('scoped transformations', () => {
  const glyph = glyphOf(P)

  it('moves only the descender when scoped to below the baseline', () => {
    const changes = applyTransformSpec([glyph], { kind: 'move', dx: 50, dy: 0 }, {
      kind: 'band',
      from: -200,
      to: -1,
    })
    const outline = changes[0].outline!
    const stem = outline.contours[0].nodes
    const bowl = outline.contours[1].nodes

    // The two anchors below the baseline moved.
    expect(stem.filter((n) => n.y < 0).every((n) => n.x >= 50)).toBe(true)
    // Everything at or above it stayed put.
    expect(bowl.every((n) => n.x < 450)).toBe(true)
    expect(Math.min(...bowl.map((n) => n.x))).toBe(140)
  })

  it('leaves the advance width alone', () => {
    const changes = applyTransformSpec([glyph], { kind: 'move', dx: 80, dy: 0 }, {
      kind: 'band',
      from: -200,
      to: -1,
    })
    expect(changes[0].advanceWidth).toBe(460)
  })

  it('scopes a scale to one contour', () => {
    const bowl = glyph.outline.contours[1]
    const changes = applyTransformSpec(
      [glyph],
      { kind: 'scale', sx: 2, sy: 1, origin: 'baseline', scaleAdvance: false },
      { kind: 'contours', contourIds: [bowl.id] },
    )
    const outline = changes[0].outline!
    // The stem is untouched.
    expect(outlineBounds({ contours: [outline.contours[0]] }).xMax).toBe(100)
    // The bowl is wider.
    expect(outlineBounds({ contours: [outline.contours[1]] }).xMax).toBeGreaterThan(500)
  })

  it('does nothing at all when the scope is empty', () => {
    const changes = applyTransformSpec([glyph], { kind: 'move', dx: 100, dy: 0 }, {
      kind: 'region',
      rect: { xMin: 9000, yMin: 9000, xMax: 9999, yMax: 9999 },
    })
    expect(outlineBounds(changes[0].outline!)).toEqual(glyph.bounds)
  })

  it('behaves exactly as before when the scope is the whole glyph', () => {
    const scoped = applyTransformSpec([glyph], { kind: 'move', dx: 30, dy: 10 }, WHOLE_GLYPH)
    const plain = applyTransformSpec([glyph], { kind: 'move', dx: 30, dy: 10 })
    expect(outlineBounds(scoped[0].outline!)).toEqual(outlineBounds(plain[0].outline!))
  })

  it('restricts a structure-changing transform to whole contours', () => {
    // Offsetting adds nodes, so it cannot be limited to loose anchors —
    // only to contours that lie entirely in scope.
    const bowl = glyph.outline.contours[1]
    const changes = applyTransformSpec(
      [glyph],
      { kind: 'offset', distance: 10 },
      { kind: 'contours', contourIds: [bowl.id] },
    )
    const outline = changes[0].outline!
    // The stem contour survives untouched, with its original four anchors.
    const stem = outline.contours.find((c) => c.id === glyph.outline.contours[0].id)
    expect(stem?.nodes).toHaveLength(4)
  })
})

describe('metricBands', () => {
  it('offers bands taken from the font’s own metrics', () => {
    const bands = metricBands({
      unitsPerEm: 1000, ascender: 750, descender: -250,
      xHeight: 500, capHeight: 700,
    })
    expect(bands.map((b) => b.id)).toContain('below-baseline')
    const below = bands.find((b) => b.id === 'below-baseline')!
    expect(below.from).toBe(-250)
    expect(below.to).toBe(0)
  })
})
