/**
 * Affine transforms over the outline model.
 *
 * Transforms move anchors and handles together, so curve shape is preserved
 * exactly (an affine map of a Bezier is the Bezier of the mapped control
 * points). Nothing is flattened or re-fitted.
 */
import type {
  Contour,
  Matrix,
  Outline,
  Point,
  Rect,
} from '@/types/geometry'
import { cloneNode } from './outline'

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function multiply(a: Matrix, b: Matrix): Matrix {
  // Applies `a` first, then `b`.
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ]
}

export function compose(...matrices: Matrix[]): Matrix {
  return matrices.reduce((acc, m) => multiply(acc, m), IDENTITY)
}

export function translation(dx: number, dy: number): Matrix {
  return [1, 0, 0, 1, dx, dy]
}

export function scaling(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0]
}

export function rotation(degrees: number): Matrix {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [cos, sin, -sin, cos, 0, 0]
}

/** Horizontal shear by `degrees`; positive leans the top to the right. */
export function skewX(degrees: number): Matrix {
  return [1, 0, Math.tan((degrees * Math.PI) / 180), 1, 0, 0]
}

export function skewY(degrees: number): Matrix {
  return [1, Math.tan((degrees * Math.PI) / 180), 0, 1, 0, 0]
}

/** Applies `matrix` about `origin` rather than about (0, 0). */
export function about(matrix: Matrix, origin: Point): Matrix {
  return compose(
    translation(-origin.x, -origin.y),
    matrix,
    translation(origin.x, origin.y),
  )
}

export function applyToPoint(matrix: Matrix, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  }
}

export function determinant(matrix: Matrix): number {
  return matrix[0] * matrix[3] - matrix[1] * matrix[2]
}

export function invert(matrix: Matrix): Matrix | null {
  const det = determinant(matrix)
  if (Math.abs(det) < 1e-12) return null
  const [a, b, c, d, e, f] = matrix
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ]
}

export function transformContour(contour: Contour, matrix: Matrix): Contour {
  const flipped = determinant(matrix) < 0
  const nodes = contour.nodes.map((node) => {
    const next = cloneNode(node)
    const anchor = applyToPoint(matrix, { x: node.x, y: node.y })
    next.x = anchor.x
    next.y = anchor.y
    next.in = node.in ? applyToPoint(matrix, node.in) : null
    next.out = node.out ? applyToPoint(matrix, node.out) : null
    return next
  })
  const result: Contour = { ...contour, nodes }
  // A mirroring transform reverses winding; restore it so fills stay correct.
  return flipped ? reverseInPlace(result) : result
}

function reverseInPlace(contour: Contour): Contour {
  const nodes = [...contour.nodes].reverse().map((node) => ({
    ...node,
    in: node.out,
    out: node.in,
  }))
  if (contour.closed && nodes.length > 1) nodes.unshift(nodes.pop()!)
  return { ...contour, nodes }
}

export function transformOutline(outline: Outline, matrix: Matrix): Outline {
  return { contours: outline.contours.map((c) => transformContour(c, matrix)) }
}

export function transformRect(rect: Rect, matrix: Matrix): Rect {
  const corners = [
    applyToPoint(matrix, { x: rect.xMin, y: rect.yMin }),
    applyToPoint(matrix, { x: rect.xMax, y: rect.yMin }),
    applyToPoint(matrix, { x: rect.xMax, y: rect.yMax }),
    applyToPoint(matrix, { x: rect.xMin, y: rect.yMax }),
  ]
  return {
    xMin: Math.min(...corners.map((p) => p.x)),
    yMin: Math.min(...corners.map((p) => p.y)),
    xMax: Math.max(...corners.map((p) => p.x)),
    yMax: Math.max(...corners.map((p) => p.y)),
  }
}

export function rectCenter(rect: Rect): Point {
  return { x: (rect.xMin + rect.xMax) / 2, y: (rect.yMin + rect.yMax) / 2 }
}

export function rectWidth(rect: Rect): number {
  return rect.xMax - rect.xMin
}

export function rectHeight(rect: Rect): number {
  return rect.yMax - rect.yMin
}
