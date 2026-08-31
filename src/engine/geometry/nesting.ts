/**
 * Contour nesting.
 *
 * Whether a contour is an outer shape or a counter cannot be read off its
 * winding: TrueType draws outers clockwise and PostScript draws them
 * counter-clockwise, and plenty of real fonts are inconsistent. What is
 * always true is containment -- a counter sits inside an outer.
 *
 * Nesting depth (how many other contours enclose this one) gives the answer
 * for any convention: even depth is ink, odd depth is a hole.
 */
import type { Contour, Outline, Point } from '@/types/geometry'
import {
  contourSegments,
  contourSignedArea,
  outlineBounds,
} from './outline'
import { cubicAt } from './bezier'
import { isPointInside } from './intersect'

/**
 * A point strictly inside the contour.
 *
 * Taken by stepping off the middle of a segment along the inward normal,
 * which works for concave shapes where the bounding-box centre would not.
 */
export function interiorPoint(contour: Contour): Point | null {
  const segments = contourSegments(contour)
  if (segments.length === 0) return null

  const bounds = outlineBounds({ contours: [contour] })
  const scale = Math.max(
    1e-6,
    Math.min(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin),
  )
  const counterClockwise = contourSignedArea(contour) > 0
  const single: Outline = { contours: [contour] }

  for (const segment of segments) {
    const point =
      segment.kind === 'line'
        ? {
            x: (segment.from.x + segment.to.x) / 2,
            y: (segment.from.y + segment.to.y) / 2,
          }
        : cubicAt(segment.from, segment.c1, segment.c2, segment.to, 0.5)

    const direction =
      segment.kind === 'line'
        ? { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y }
        : {
            x: segment.to.x - segment.from.x,
            y: segment.to.y - segment.from.y,
          }
    const length = Math.hypot(direction.x, direction.y)
    if (length < 1e-9) continue

    // Interior lies to the left of travel for a counter-clockwise contour.
    const sign = counterClockwise ? 1 : -1
    const nx = (-direction.y / length) * sign
    const ny = (direction.x / length) * sign

    for (const fraction of [0.002, 0.01, 0.05]) {
      const step = scale * fraction
      const candidate = { x: point.x + nx * step, y: point.y + ny * step }
      if (isPointInside(single, candidate)) return candidate
    }
  }
  return null
}

/**
 * How many other contours enclose each contour. Index-aligned with
 * `outline.contours`.
 */
export function contourNestingDepths(outline: Outline): number[] {
  const contours = outline.contours
  const samples = contours.map(interiorPoint)

  return contours.map((_, index) => {
    const sample = samples[index]
    if (!sample) return 0
    let depth = 0
    for (let other = 0; other < contours.length; other += 1) {
      if (other === index) continue
      if (isPointInside({ contours: [contours[other]] }, sample)) depth += 1
    }
    return depth
  })
}

/** True for contours that add ink (even nesting depth). */
export function contourIsOuter(outline: Outline): boolean[] {
  return contourNestingDepths(outline).map((depth) => depth % 2 === 0)
}
