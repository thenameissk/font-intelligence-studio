import { describe, expect, it } from 'vitest'
import type { Rect } from '@/types/geometry'
import type { GlyphStructure } from '@/engine/analysis/glyphStructure'
import { CONSTRUCTION } from '@/engine/analysis/glyphStructure'
import { buildAnnotations, placeLabels } from './annotations'

const bounds: Rect = { xMin: 0, yMin: 0, xMax: 1000, yMax: 1000 }

function structure(overrides: Partial<GlyphStructure> = {}): GlyphStructure {
  return {
    contourCount: 1,
    counters: [],
    construction: CONSTRUCTION.TwoStorey,
    constructionCertainty: 'measured',
    tail: null,
    junction: null,
    notes: [],
    ...overrides,
  }
}

describe('buildAnnotations', () => {
  it('calls the narrowest join "Thinner"', () => {
    const annotations = buildAnnotations({
      structure: structure({ junction: { thickness: 90, x: 520, y: 400 } }),
      bounds,
      unitsPerEm: 1000,
    })
    expect(annotations.map((a) => a.label)).toContain('Thinner')
  })

  it('names a tail', () => {
    const annotations = buildAnnotations({
      structure: structure({
        tail: {
          bounds: { xMin: 700, xMax: 900, yMin: 0, yMax: 150 },
          reach: 200,
          height: 150,
        },
      }),
      bounds,
      unitsPerEm: 1000,
    })
    expect(annotations.map((a) => a.label)).toContain('Tail')
  })

  it('never returns more than the limit', () => {
    const annotations = buildAnnotations({
      structure: structure({
        junction: { thickness: 90, x: 520, y: 400 },
        tail: {
          bounds: { xMin: 700, xMax: 900, yMin: 0, yMax: 150 },
          reach: 200,
          height: 150,
        },
      }),
      bounds,
      unitsPerEm: 1000,
      hotspots: [
        { x: 100, y: 900, radius: 50, label: 'Arch', magnitude: 80 },
        { x: 500, y: 900, radius: 50, label: 'Shoulder', magnitude: 70 },
      ],
      limit: 2,
    })
    expect(annotations).toHaveLength(2)
  })

  it('drops a callout that sits on top of another', () => {
    const annotations = buildAnnotations({
      structure: structure({ junction: { thickness: 90, x: 520, y: 400 } }),
      bounds,
      unitsPerEm: 1000,
      // Same place as the junction callout, different name.
      hotspots: [{ x: 520, y: 405, radius: 40, label: 'Aperture', magnitude: 99 }],
      limit: 3,
    })
    expect(annotations).toHaveLength(1)
    expect(annotations[0].label).toBe('Thinner')
  })

  it('prefers a callout the change list confirms', () => {
    const withChange = buildAnnotations({
      structure: structure({ junction: { thickness: 90, x: 520, y: 400 } }),
      bounds,
      unitsPerEm: 1000,
      changes: [
        { id: 'junction', label: 'Thinner join', detail: '90 → 60 units' },
      ],
    })
    expect(withChange[0].label).toBe('Thinner join')
  })
})

describe('placeLabels', () => {
  it('separates labels that would land on each other', () => {
    const placed = placeLabels(
      [
        { id: 'a', x: 500, y: 500, radius: 60, label: 'One', priority: 10 },
        { id: 'b', x: 520, y: 520, radius: 60, label: 'Two', priority: 9 },
      ],
      { fontSize: 60, bounds },
    )
    expect(Math.abs(placed[0].labelY - placed[1].labelY)).toBeGreaterThan(40)
  })

  it('keeps a label near the left edge inside the diagram', () => {
    const placed = placeLabels(
      [{ id: 'a', x: 5, y: 500, radius: 60, label: 'Edge', priority: 10 }],
      { fontSize: 60, bounds },
    )
    expect(placed[0].anchor).toBe('start')
    expect(placed[0].labelX).toBeGreaterThanOrEqual(bounds.xMin)
  })

  it('draws a leader only when the label had to move clear', () => {
    const [close] = placeLabels(
      [{ id: 'a', x: 500, y: 500, radius: 60, label: 'Close', priority: 10 }],
      { fontSize: 60, bounds },
    )
    expect(close.leader).toBeNull()
  })
})
