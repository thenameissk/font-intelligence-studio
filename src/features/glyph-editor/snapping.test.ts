import { describe, expect, it } from 'vitest'
import { snapAxis, snapPoint, type SnapTarget } from './snapping'

const targets: SnapTarget[] = [
  { value: 0, label: 'baseline', kind: 'origin' },
  { value: 500, label: 'x-height', kind: 'metric' },
  { value: 503, label: 'node', kind: 'node' },
]

describe('snapAxis', () => {
  it('snaps to the nearest candidate inside the tolerance', () => {
    expect(snapAxis(497, targets, 10, 0).value).toBe(500)
  })

  it('leaves the value alone outside the tolerance', () => {
    const result = snapAxis(460, targets, 10, 0)
    expect(result.value).toBe(460)
    expect(result.target).toBeNull()
  })

  it('prefers a metric over a node at equal distance', () => {
    // 501.5 is 1.5 from both the x-height at 500 and the node at 503.
    expect(snapAxis(501.5, targets, 10, 0).target?.kind).toBe('metric')
  })

  it('falls back to the grid when nothing else is close', () => {
    const result = snapAxis(103, [], 10, 10)
    expect(result.value).toBe(100)
    expect(result.target?.kind).toBe('grid')
  })

  it('does not snap to the grid beyond the tolerance', () => {
    expect(snapAxis(105, [], 2, 10).value).toBe(105)
  })

  it('ignores the grid when it is disabled', () => {
    expect(snapAxis(103, [], 10, 0).value).toBe(103)
  })
})

describe('snapPoint', () => {
  it('snaps both axes independently', () => {
    const result = snapPoint(
      { x: 2, y: 498 },
      {
        x: [{ value: 0, label: 'origin', kind: 'origin' }],
        y: targets,
        tolerance: 8,
        grid: 0,
      },
    )
    expect(result.point).toEqual({ x: 0, y: 500 })
    expect(result.x?.kind).toBe('origin')
    expect(result.y?.kind).toBe('metric')
  })
})
