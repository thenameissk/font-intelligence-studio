/**
 * Parser-facing repairs for fonts that are valid but awkward.
 *
 * These produce a SEPARATE buffer used only for parsing. The imported bytes
 * stay untouched, so export still writes the font's original tables.
 *
 * The one repair we need today: opentype.js scans cmap encoding records
 * from last to first and commits to the first record with a recognised
 * platform/encoding pair, without checking that the subtable format is one
 * it can read. Fonts such as Helvetica.ttc list several Macintosh format 6
 * subtables after a perfectly good Unicode format 4 subtable, so the parser
 * picks a format it cannot handle and rejects the whole font. Masking the
 * unusable records makes it fall through to the one it can read.
 */
import type { ImportWarning } from '@/types/font'
import { findTable, readTableDirectory } from './sfnt'

/** Subtable formats opentype.js can actually decode. */
const SUPPORTED_FORMATS = new Set([0, 4, 12, 13, 14])

/** A platform id opentype.js will never match, so the record is skipped. */
const MASKED_PLATFORM = 0xffff

interface CmapRecord {
  recordOffset: number
  platformId: number
  encodingId: number
  subtableOffset: number
  format: number
}

function readCmapRecords(
  view: DataView,
  start: number,
  length: number,
): CmapRecord[] {
  if (length < 4) return []
  const numTables = view.getUint16(start + 2)
  const records: CmapRecord[] = []
  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = start + 4 + i * 8
    if (recordOffset + 8 > start + length) break
    const subtableOffset = view.getUint32(recordOffset + 4)
    if (subtableOffset + 2 > length) continue
    records.push({
      recordOffset,
      platformId: view.getUint16(recordOffset),
      encodingId: view.getUint16(recordOffset + 2),
      subtableOffset,
      format: view.getUint16(start + subtableOffset),
    })
  }
  return records
}

/** Mirrors opentype.js's own acceptance test for a platform/encoding pair. */
function isAcceptedByParser(record: CmapRecord): boolean {
  const { platformId, encodingId } = record
  if (platformId === 3) return [0, 1, 10].includes(encodingId)
  if (platformId === 0) return [0, 1, 2, 3, 4, 5, 6].includes(encodingId)
  if (platformId === 1) return encodingId === 0
  return false
}

export interface SanitizeResult {
  /** Buffer to hand to the parser; the input itself when no repair applied. */
  buffer: ArrayBuffer
  warnings: ImportWarning[]
}

/** Higher is better. Unicode coverage beats legacy 8-bit tables. */
function formatScore(format: number): number {
  switch (format) {
    case 12:
    case 13:
      return 40
    case 4:
      return 30
    case 0:
      return 10
    default:
      return 0
  }
}

function platformScore(platformId: number): number {
  if (platformId === 3) return 3
  if (platformId === 0) return 2
  return 1
}

function isVariationSelectorRecord(record: CmapRecord): boolean {
  return record.format === 14
}

export function sanitizeForParsing(sfnt: ArrayBuffer): SanitizeResult {
  const warnings: ImportWarning[] = []
  let directory
  try {
    directory = readTableDirectory(sfnt)
  } catch {
    return { buffer: sfnt, warnings }
  }

  const cmap = findTable(directory, 'cmap')
  if (!cmap) return { buffer: sfnt, warnings }

  const view = new DataView(sfnt, cmap.offset, cmap.length)
  const records = readCmapRecords(view, 0, cmap.length)
  if (records.length === 0) return { buffer: sfnt, warnings }

  const accepted = records.filter(
    (r) => isAcceptedByParser(r) && !isVariationSelectorRecord(r),
  )
  const usable = accepted.filter((r) => SUPPORTED_FORMATS.has(r.format))

  if (usable.length === 0) {
    if (accepted.length > 0) {
      warnings.push({
        severity: 'warning',
        message: `This font's character map uses format ${accepted[0].format}, which is not supported. Glyphs may show as unencoded.`,
      })
    }
    return { buffer: sfnt, warnings }
  }

  const best = usable.reduce((a, b) => {
    const byFormat = formatScore(b.format) - formatScore(a.format)
    if (byFormat !== 0) return byFormat > 0 ? b : a
    return platformScore(b.platformId) > platformScore(a.platformId) ? b : a
  })

  const toMask = accepted.filter((r) => r !== best)
  const needsReorder = best.format === 0 && best.recordOffset !== 4
  if (toMask.length === 0 && !needsReorder) {
    return { buffer: sfnt, warnings }
  }

  const copy = sfnt.slice(0)
  const copyView = new DataView(copy, cmap.offset, cmap.length)

  if (needsReorder) {
    // opentype.js reads the encoding of a format 0 subtable from whichever
    // record happens to be first, so the chosen record has to sit there.
    const bytes = new Uint8Array(copy, cmap.offset, cmap.length)
    const chosen = bytes.slice(best.recordOffset, best.recordOffset + 8)
    const first = bytes.slice(4, 12)
    bytes.set(chosen, 4)
    bytes.set(first, best.recordOffset)
    for (const record of toMask) {
      const offset = record.recordOffset === 4 ? best.recordOffset : record.recordOffset
      copyView.setUint16(offset, MASKED_PLATFORM)
    }
  } else {
    for (const record of toMask) {
      copyView.setUint16(record.recordOffset, MASKED_PLATFORM)
    }
  }

  const skippedFormats = [
    ...new Set(toMask.filter((r) => !SUPPORTED_FORMATS.has(r.format)).map((r) => r.format)),
  ]
  warnings.push({
    severity: 'info',
    message:
      skippedFormats.length > 0
        ? `Character map: ignored ${toMask.length} subtable${toMask.length === 1 ? '' : 's'} in unsupported format${skippedFormats.length === 1 ? '' : 's'} ${skippedFormats.join(', ')}.`
        : `Character map: using the format ${best.format} subtable (platform ${best.platformId}).`,
    detail:
      'The original table is preserved and written back unchanged on export.',
  })

  return { buffer: copy, warnings }
}
