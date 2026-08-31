/**
 * TrueType `glyf` and `loca` writing.
 *
 * Only edited glyphs are re-encoded. Every untouched glyph keeps its
 * original bytes verbatim, which means composites stay composite, hinting
 * instructions survive, and the exported file differs from the imported one
 * only where the user actually changed something.
 */
import type { Outline, Rect } from '@/types/geometry'
import { contourSegments, outlineBounds } from '@/engine/geometry/outline'
import { cubicToQuadratics } from '@/engine/geometry/cubicToQuadratic'

const ON_CURVE = 0x01
const X_SHORT = 0x02
const Y_SHORT = 0x04
const REPEAT = 0x08
const X_SAME_OR_POSITIVE = 0x10
const Y_SAME_OR_POSITIVE = 0x20

interface GlyfPoint {
  x: number
  y: number
  onCurve: boolean
}

/**
 * Converts an outline to TrueType point lists.
 *
 * Cubics are approximated by quadratics; each quadratic contributes one
 * off-curve control point followed by its on-curve end point. Implied
 * on-curve midpoints are not used, which costs a little size but keeps the
 * encoding unambiguous.
 */
function outlineToContours(
  outline: Outline,
  tolerance: number,
): GlyfPoint[][] {
  const contours: GlyfPoint[][] = []

  for (const contour of outline.contours) {
    if (contour.nodes.length === 0) continue
    const points: GlyfPoint[] = []
    const segments = contourSegments(contour)
    if (segments.length === 0) {
      const node = contour.nodes[0]
      contours.push([{ x: node.x, y: node.y, onCurve: true }])
      continue
    }

    points.push({
      x: segments[0].from.x,
      y: segments[0].from.y,
      onCurve: true,
    })

    for (const segment of segments) {
      if (segment.kind === 'line') {
        points.push({ x: segment.to.x, y: segment.to.y, onCurve: true })
        continue
      }
      const quads = cubicToQuadratics(
        segment.from,
        segment.c1,
        segment.c2,
        segment.to,
        tolerance,
      )
      for (const quad of quads) {
        points.push({ x: quad.control.x, y: quad.control.y, onCurve: false })
        points.push({ x: quad.to.x, y: quad.to.y, onCurve: true })
      }
    }

    // The contour is implicitly closed, so the repeated start point goes.
    if (points.length > 1) {
      const first = points[0]
      const last = points[points.length - 1]
      if (
        last.onCurve &&
        Math.abs(last.x - first.x) < 1e-6 &&
        Math.abs(last.y - first.y) < 1e-6
      ) {
        points.pop()
      }
    }

    if (points.length >= 2) contours.push(points)
  }

  return contours
}

export interface EncodedGlyph {
  data: Uint8Array
  bounds: Rect
  pointCount: number
  contourCount: number
}

/** Encodes one simple glyph. An empty outline encodes as zero bytes. */
export function encodeSimpleGlyph(
  outline: Outline,
  tolerance = 0.35,
): EncodedGlyph {
  const contours = outlineToContours(outline, tolerance)
  const points = contours.flat()

  if (contours.length === 0 || points.length === 0) {
    return {
      data: new Uint8Array(0),
      bounds: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      pointCount: 0,
      contourCount: 0,
    }
  }

  const rounded = points.map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
    onCurve: point.onCurve,
  }))

  const bounds: Rect = {
    xMin: Math.min(...rounded.map((p) => p.x)),
    yMin: Math.min(...rounded.map((p) => p.y)),
    xMax: Math.max(...rounded.map((p) => p.x)),
    yMax: Math.max(...rounded.map((p) => p.y)),
  }

  // Flags and delta-encoded coordinates.
  const flags: number[] = []
  const xBytes: number[] = []
  const yBytes: number[] = []
  let previousX = 0
  let previousY = 0

  for (const point of rounded) {
    let flag = point.onCurve ? ON_CURVE : 0
    const dx = point.x - previousX
    const dy = point.y - previousY

    if (dx === 0) {
      flag |= X_SAME_OR_POSITIVE
    } else if (dx >= -255 && dx <= 255) {
      flag |= X_SHORT
      if (dx > 0) flag |= X_SAME_OR_POSITIVE
      xBytes.push(Math.abs(dx))
    } else {
      xBytes.push((dx >> 8) & 0xff, dx & 0xff)
    }

    if (dy === 0) {
      flag |= Y_SAME_OR_POSITIVE
    } else if (dy >= -255 && dy <= 255) {
      flag |= Y_SHORT
      if (dy > 0) flag |= Y_SAME_OR_POSITIVE
      yBytes.push(Math.abs(dy))
    } else {
      yBytes.push((dy >> 8) & 0xff, dy & 0xff)
    }

    flags.push(flag)
    previousX = point.x
    previousY = point.y
  }

  // Run-length compress identical consecutive flags.
  const packedFlags: number[] = []
  for (let i = 0; i < flags.length; ) {
    const flag = flags[i]
    let run = 1
    while (i + run < flags.length && flags[i + run] === flag && run < 256) {
      run += 1
    }
    if (run > 1) {
      packedFlags.push(flag | REPEAT, run - 1)
    } else {
      packedFlags.push(flag)
    }
    i += run
  }

  const endPts: number[] = []
  let total = 0
  for (const contour of contours) {
    total += contour.length
    endPts.push(total - 1)
  }

  const size =
    10 + endPts.length * 2 + 2 + packedFlags.length + xBytes.length + yBytes.length
  const data = new Uint8Array(size)
  const view = new DataView(data.buffer)
  let offset = 0

  view.setInt16(offset, contours.length)
  offset += 2
  view.setInt16(offset, bounds.xMin)
  offset += 2
  view.setInt16(offset, bounds.yMin)
  offset += 2
  view.setInt16(offset, bounds.xMax)
  offset += 2
  view.setInt16(offset, bounds.yMax)
  offset += 2

  for (const end of endPts) {
    view.setUint16(offset, end)
    offset += 2
  }

  // No hinting instructions: edited outlines invalidate the original ones.
  view.setUint16(offset, 0)
  offset += 2

  data.set(packedFlags, offset)
  offset += packedFlags.length
  data.set(xBytes, offset)
  offset += xBytes.length
  data.set(yBytes, offset)

  return {
    data,
    bounds,
    pointCount: rounded.length,
    contourCount: contours.length,
  }
}

export interface GlyfBuildInput {
  glyphCount: number
  /** Original glyf bytes for a glyph, or null when it has none. */
  originalBytes: (glyphIndex: number) => Uint8Array | null
  /** Edited outline for a glyph, or null when unchanged. */
  editedOutline: (glyphIndex: number) => Outline | null
  tolerance?: number
}

export interface GlyfBuildResult {
  glyf: Uint8Array
  loca: Uint8Array
  /** 1 = long loca. This writer always uses long format. */
  indexToLocFormat: 1
  fontBounds: Rect
  maxPoints: number
  maxContours: number
  /** Per-glyph ink bounds, used to rebuild hmtx and hhea. */
  bounds: Array<Rect | null>
}

function readBounds(data: Uint8Array): Rect | null {
  if (data.length < 10) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return {
    xMin: view.getInt16(2),
    yMin: view.getInt16(4),
    xMax: view.getInt16(6),
    yMax: view.getInt16(8),
  }
}

/**
 * Assembles the whole `glyf` table plus its `loca` index.
 *
 * `loca` is always written in long format: it is unconditionally valid, and
 * it avoids a class of bug where a font grows past the 128 KB the short
 * format can address.
 */
export function buildGlyf(input: GlyfBuildInput): GlyfBuildResult {
  const pieces: Uint8Array[] = []
  const offsets: number[] = []
  const bounds: Array<Rect | null> = []
  let total = 0
  let maxPoints = 0
  let maxContours = 0

  let fontBounds: Rect | null = null
  const extend = (rect: Rect | null): void => {
    if (!rect) return
    fontBounds = fontBounds
      ? {
          xMin: Math.min(fontBounds.xMin, rect.xMin),
          yMin: Math.min(fontBounds.yMin, rect.yMin),
          xMax: Math.max(fontBounds.xMax, rect.xMax),
          yMax: Math.max(fontBounds.yMax, rect.yMax),
        }
      : { ...rect }
  }

  for (let index = 0; index < input.glyphCount; index += 1) {
    offsets.push(total)
    const edited = input.editedOutline(index)

    let data: Uint8Array
    let glyphBounds: Rect | null

    if (edited) {
      const encoded = encodeSimpleGlyph(edited, input.tolerance)
      data = encoded.data
      glyphBounds = encoded.pointCount > 0 ? encoded.bounds : null
      maxPoints = Math.max(maxPoints, encoded.pointCount)
      maxContours = Math.max(maxContours, encoded.contourCount)
    } else {
      data = input.originalBytes(index) ?? new Uint8Array(0)
      glyphBounds = data.length > 0 ? readBounds(data) : null
    }

    // Each glyph description must start on a 4-byte boundary.
    const padding = (4 - (data.length % 4)) % 4
    if (padding > 0) {
      const padded = new Uint8Array(data.length + padding)
      padded.set(data)
      data = padded
    }

    pieces.push(data)
    bounds.push(glyphBounds)
    extend(glyphBounds)
    total += data.length
  }
  offsets.push(total)

  const glyf = new Uint8Array(total)
  let cursor = 0
  for (const piece of pieces) {
    glyf.set(piece, cursor)
    cursor += piece.length
  }

  const loca = new Uint8Array(offsets.length * 4)
  const locaView = new DataView(loca.buffer)
  offsets.forEach((offset, index) => locaView.setUint32(index * 4, offset))

  return {
    glyf,
    loca,
    indexToLocFormat: 1,
    fontBounds: fontBounds ?? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    maxPoints,
    maxContours,
    bounds,
  }
}

export { outlineBounds }
