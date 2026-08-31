/**
 * Writers and patchers for the small binary tables the exporter has to
 * update when geometry or metrics change.
 *
 * Patchers copy the original table and overwrite individual fields, so
 * anything we do not model (flags, dates, hinting parameters) survives
 * exactly as it was in the imported font.
 */
import type { Rect } from '@/types/geometry'

export interface GlyphMetric {
  advanceWidth: number
  leftSideBearing: number
}

/** hmtx with a full metric for every glyph (numberOfHMetrics = numGlyphs). */
export function buildHmtx(metrics: readonly GlyphMetric[]): Uint8Array {
  const out = new Uint8Array(metrics.length * 4)
  const view = new DataView(out.buffer)
  metrics.forEach((metric, index) => {
    const advance = Math.max(0, Math.min(0xffff, Math.round(metric.advanceWidth)))
    const lsb = Math.max(-32768, Math.min(32767, Math.round(metric.leftSideBearing)))
    view.setUint16(index * 4, advance)
    view.setInt16(index * 4 + 2, lsb)
  })
  return out
}

export interface HeadPatch {
  bounds: Rect
  indexToLocFormat: 0 | 1
}

export function patchHead(original: Uint8Array, patch: HeadPatch): Uint8Array {
  if (original.length < 54) {
    throw new Error('The head table is too short to be valid.')
  }
  const out = original.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const clamp = (value: number): number =>
    Math.max(-32768, Math.min(32767, Math.round(value)))

  view.setInt16(36, clamp(patch.bounds.xMin))
  view.setInt16(38, clamp(patch.bounds.yMin))
  view.setInt16(40, clamp(patch.bounds.xMax))
  view.setInt16(42, clamp(patch.bounds.yMax))
  view.setInt16(50, patch.indexToLocFormat)
  // buildSfnt recomputes this over the finished file.
  view.setUint32(8, 0)
  return out
}

export interface HheaPatch {
  advanceWidthMax: number
  minLeftSideBearing: number
  minRightSideBearing: number
  xMaxExtent: number
  numberOfHMetrics: number
}

export function patchHhea(original: Uint8Array, patch: HheaPatch): Uint8Array {
  if (original.length < 36) {
    throw new Error('The hhea table is too short to be valid.')
  }
  const out = original.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const clampSigned = (value: number): number =>
    Math.max(-32768, Math.min(32767, Math.round(value)))

  view.setUint16(10, Math.max(0, Math.min(0xffff, Math.round(patch.advanceWidthMax))))
  view.setInt16(12, clampSigned(patch.minLeftSideBearing))
  view.setInt16(14, clampSigned(patch.minRightSideBearing))
  view.setInt16(16, clampSigned(patch.xMaxExtent))
  view.setUint16(34, Math.max(1, Math.min(0xffff, patch.numberOfHMetrics)))
  return out
}

export interface MaxpPatch {
  numGlyphs: number
  maxPoints: number
  maxContours: number
}

/** Patches a version 1.0 maxp, or builds one when converting to TrueType. */
export function buildMaxpTrueType(
  original: Uint8Array | null,
  patch: MaxpPatch,
): Uint8Array {
  const out =
    original && original.length >= 32 ? original.slice() : new Uint8Array(32)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)

  view.setUint32(0, 0x00010000)
  view.setUint16(4, patch.numGlyphs)
  // Outlines are re-encoded without composites, so the component limits are
  // reported as unused rather than carried over from the original.
  view.setUint16(6, Math.min(0xffff, Math.max(view.getUint16(6), patch.maxPoints)))
  view.setUint16(8, Math.min(0xffff, Math.max(view.getUint16(8), patch.maxContours)))
  if (!original || original.length < 32) {
    view.setUint16(10, patch.maxPoints)
    view.setUint16(12, patch.maxContours)
    view.setUint16(14, 2) // maxZones
    view.setUint16(24, 64) // maxStackElements
  }
  return out
}

/** maxp version 0.5, which is what a CFF-flavoured font uses. */
export function buildMaxpCff(numGlyphs: number): Uint8Array {
  const out = new Uint8Array(6)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x00005000)
  view.setUint16(4, numGlyphs)
  return out
}

export interface KernPairRecord {
  left: number
  right: number
  value: number
}

/** A subtable length is a uint16, which caps how many pairs can fit. */
export const MAX_KERN_PAIRS = Math.floor((0xffff - 14) / 6)

/**
 * Builds a legacy format 0 `kern` table.
 *
 * This is the only kerning format we can write: rebuilding a GPOS pair
 * lookup is out of scope, and the UI says so wherever it matters.
 */
export function buildKern(pairs: readonly KernPairRecord[]): Uint8Array | null {
  const usable = pairs
    .filter((pair) => pair.value !== 0)
    .slice(0, MAX_KERN_PAIRS)
    .sort((a, b) => a.left - b.left || a.right - b.right)

  if (usable.length === 0) return null

  const subtableLength = 14 + usable.length * 6
  const out = new Uint8Array(4 + subtableLength)
  const view = new DataView(out.buffer)

  view.setUint16(0, 0) // version
  view.setUint16(2, 1) // number of subtables

  view.setUint16(4, 0) // subtable version
  view.setUint16(6, subtableLength)
  view.setUint16(8, 0x0001) // format 0, horizontal

  const count = usable.length
  let entrySelector = 0
  while (1 << (entrySelector + 1) <= count) entrySelector += 1
  const searchRange = (1 << entrySelector) * 6

  view.setUint16(10, count)
  view.setUint16(12, searchRange)
  view.setUint16(14, entrySelector)
  view.setUint16(16, count * 6 - searchRange)

  usable.forEach((pair, index) => {
    const offset = 18 + index * 6
    view.setUint16(offset, pair.left)
    view.setUint16(offset + 2, pair.right)
    view.setInt16(
      offset + 4,
      Math.max(-32768, Math.min(32767, Math.round(pair.value))),
    )
  })

  return out
}

/** Updates OS/2 xAvgCharWidth, which tools use for rough width comparisons. */
export function patchOs2(
  original: Uint8Array,
  averageWidth: number,
): Uint8Array {
  if (original.length < 4) return original
  const out = original.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setInt16(2, Math.max(-32768, Math.min(32767, Math.round(averageWidth))))
  return out
}
