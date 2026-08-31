import { describe, expect, it } from 'vitest'
import type { ResolvedGlyph } from '@/types/font'
import { commandsToOutline, outlineBounds } from '@/engine/geometry/outline'
import {
  setAdvanceWidth,
  setLeftSideBearing,
  setRightSideBearing,
  setSideBearings,
  shiftVertically,
} from './metrics'

function makeGlyph(): ResolvedGlyph {
  const outline = commandsToOutline([
    { type: 'M', x: 100, y: 0 },
    { type: 'L', x: 400, y: 0 },
    { type: 'L', x: 400, y: 700 },
    { type: 'L', x: 100, y: 700 },
    { type: 'Z' },
  ])
  const bounds = outlineBounds(outline)
  return {
    index: 1,
    name: 'test',
    unicode: null,
    unicodes: [],
    advanceWidth: 500,
    outline,
    components: [],
    bounds,
    leftSideBearing: bounds.xMin,
    rightSideBearing: 500 - bounds.xMax,
    isComposite: false,
    isEmpty: false,
    modified: false,
  }
}

describe('metric edits', () => {
  it('sets the advance width without moving the outline', () => {
    const glyph = makeGlyph()
    const edit = setAdvanceWidth(glyph, 620)
    expect(edit.advanceWidth).toBe(620)
    expect(outlineBounds(edit.outline!)).toEqual(glyph.bounds)
  })

  it('translates the outline to set the left side bearing', () => {
    const glyph = makeGlyph()
    const edit = setLeftSideBearing(glyph, 40)
    const bounds = outlineBounds(edit.outline!)
    expect(bounds.xMin).toBeCloseTo(40, 9)
    // The glyph keeps its width and its advance.
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(300, 9)
    expect(edit.advanceWidth).toBe(500)
  })

  it('changes the advance width to set the right side bearing', () => {
    const glyph = makeGlyph()
    const edit = setRightSideBearing(glyph, 60)
    expect(edit.advanceWidth).toBe(460)
    expect(outlineBounds(edit.outline!)).toEqual(glyph.bounds)
  })

  it('sets both bearings and recomputes the advance', () => {
    const glyph = makeGlyph()
    const edit = setSideBearings(glyph, 50, 70)
    const bounds = outlineBounds(edit.outline!)
    expect(bounds.xMin).toBeCloseTo(50, 9)
    expect(edit.advanceWidth).toBe(50 + 300 + 70)
  })

  it('shifts vertically without changing horizontal metrics', () => {
    const glyph = makeGlyph()
    const edit = shiftVertically(glyph, -25)
    const bounds = outlineBounds(edit.outline!)
    expect(bounds.yMin).toBeCloseTo(-25, 9)
    expect(bounds.xMin).toBeCloseTo(100, 9)
    expect(edit.advanceWidth).toBe(500)
  })

  it('never produces a negative advance width', () => {
    const glyph = makeGlyph()
    expect(setAdvanceWidth(glyph, -50).advanceWidth).toBe(0)
    expect(setRightSideBearing(glyph, -1000).advanceWidth).toBe(0)
  })
})
