import { describe, expect, it } from 'vitest'
import { cubicAt } from './bezier'
import { cubicToQuadratics, type Quadratic } from './cubicToQuadratic'

function quadAt(q: Quadratic, t: number) {
  const mt = 1 - t
  return {
    x: mt * mt * q.from.x + 2 * mt * t * q.control.x + t * t * q.to.x,
    y: mt * mt * q.from.y + 2 * mt * t * q.control.y + t * t * q.to.y,
  }
}

/**
 * Worst distance from a point on the cubic to the quadratic chain.
 *
 * The chain is sampled densely: at a coarse sampling the gaps between
 * samples dominate the measurement and it reports the sampling step rather
 * than the approximation error.
 */
function worstError(
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p3: { x: number; y: number },
  quads: Quadratic[],
): number {
  const samples: Array<{ x: number; y: number }> = []
  for (const q of quads) {
    for (let i = 0; i <= 600; i += 1) samples.push(quadAt(q, i / 600))
  }
  let worst = 0
  for (let i = 0; i <= 100; i += 1) {
    const point = cubicAt(p0, c1, c2, p3, i / 100)
    const nearest = Math.min(
      ...samples.map((s) => Math.hypot(s.x - point.x, s.y - point.y)),
    )
    worst = Math.max(worst, nearest)
  }
  return worst
}

describe('cubicToQuadratics', () => {
  it('converts an elevated quadratic back exactly', () => {
    // A quadratic with control Q, raised to cubic form.
    const p0 = { x: 0, y: 0 }
    const q = { x: 100, y: 200 }
    const p3 = { x: 200, y: 0 }
    const c1 = { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) }
    const c2 = { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y) }

    const quads = cubicToQuadratics(p0, c1, c2, p3)
    expect(quads).toHaveLength(1)
    expect(quads[0].control.x).toBeCloseTo(q.x, 6)
    expect(quads[0].control.y).toBeCloseTo(q.y, 6)
  })

  it('keeps a quarter-circle arc within tolerance', () => {
    const r = 500
    const k = 0.5522847498307936 * r
    const p0 = { x: r, y: 0 }
    const c1 = { x: r, y: k }
    const c2 = { x: k, y: r }
    const p3 = { x: 0, y: r }

    const quads = cubicToQuadratics(p0, c1, c2, p3, 0.35)
    expect(worstError(p0, c1, c2, p3, quads)).toBeLessThan(0.35)
  })

  it('subdivides an S-curve until it fits', () => {
    const p0 = { x: 0, y: 0 }
    const c1 = { x: 400, y: 600 }
    const c2 = { x: -200, y: 600 }
    const p3 = { x: 300, y: 0 }

    const quads = cubicToQuadratics(p0, c1, c2, p3, 0.5)
    expect(quads.length).toBeGreaterThan(1)
    expect(worstError(p0, c1, c2, p3, quads)).toBeLessThan(0.5)
  })

  it('preserves the endpoints exactly', () => {
    const p0 = { x: 13, y: -7 }
    const c1 = { x: 400, y: 600 }
    const c2 = { x: -200, y: 600 }
    const p3 = { x: 311, y: 42 }
    const quads = cubicToQuadratics(p0, c1, c2, p3)
    expect(quads[0].from).toEqual(p0)
    expect(quads[quads.length - 1].to).toEqual(p3)
  })

  it('chains end to end with no gaps', () => {
    const quads = cubicToQuadratics(
      { x: 0, y: 0 },
      { x: 400, y: 600 },
      { x: -200, y: 600 },
      { x: 300, y: 0 },
      0.2,
    )
    for (let i = 1; i < quads.length; i += 1) {
      expect(quads[i].from.x).toBeCloseTo(quads[i - 1].to.x, 9)
      expect(quads[i].from.y).toBeCloseTo(quads[i - 1].to.y, 9)
    }
  })

  it('handles a straight cubic without blowing up', () => {
    const quads = cubicToQuadratics(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    )
    expect(quads).toHaveLength(1)
    for (const q of quads) {
      expect(Number.isFinite(q.control.x)).toBe(true)
      expect(Number.isFinite(q.control.y)).toBe(true)
    }
  })

  it('tightens with a smaller tolerance', () => {
    const args = [
      { x: 0, y: 0 },
      { x: 400, y: 600 },
      { x: -200, y: 600 },
      { x: 300, y: 0 },
    ] as const
    const coarse = cubicToQuadratics(...args, 2)
    const fine = cubicToQuadratics(...args, 0.05)
    expect(fine.length).toBeGreaterThan(coarse.length)
    expect(worstError(...args, fine)).toBeLessThan(0.05)
  })
})
