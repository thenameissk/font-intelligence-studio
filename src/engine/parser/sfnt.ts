/**
 * Low-level sfnt (TrueType/OpenType) container handling.
 *
 * This module knows nothing about glyphs. It reads and writes the table
 * directory so that higher layers can replace individual tables while
 * leaving every other table byte-identical to the imported font -- which is
 * how the exporter preserves GPOS/GDEF/kern/variable data that our parser
 * does not model.
 */

export interface SfntTable {
  tag: string
  offset: number
  length: number
  checksum: number
}

export interface SfntDirectory {
  /** 0x00010000 (TrueType), 'OTTO' (CFF) or 'true'. */
  sfntVersion: number
  tables: SfntTable[]
}

export const SFNT_VERSION_TRUETYPE = 0x00010000
export const SFNT_VERSION_OTTO = 0x4f54544f // 'OTTO'
export const SFNT_VERSION_TRUE = 0x74727565 // 'true'
export const SFNT_VERSION_TTCF = 0x74746366 // 'ttcf'
export const WOFF_SIGNATURE = 0x774f4646 // 'wOFF'
export const WOFF2_SIGNATURE = 0x774f4632 // 'wOF2'

export function readTag(view: DataView, offset: number): string {
  return (
    String.fromCharCode(view.getUint8(offset)) +
    String.fromCharCode(view.getUint8(offset + 1)) +
    String.fromCharCode(view.getUint8(offset + 2)) +
    String.fromCharCode(view.getUint8(offset + 3))
  )
}

export function tagToUint32(tag: string): number {
  const padded = tag.padEnd(4, ' ')
  return (
    ((padded.charCodeAt(0) << 24) |
      (padded.charCodeAt(1) << 16) |
      (padded.charCodeAt(2) << 8) |
      padded.charCodeAt(3)) >>>
    0
  )
}

export function isKnownSfntVersion(version: number): boolean {
  return (
    version === SFNT_VERSION_TRUETYPE ||
    version === SFNT_VERSION_OTTO ||
    version === SFNT_VERSION_TRUE
  )
}

/**
 * Parses the sfnt table directory. Accepts a bare sfnt only -- WOFF/WOFF2
 * must be unwrapped first (see decode.ts).
 */
export function readTableDirectory(buffer: ArrayBuffer): SfntDirectory {
  if (buffer.byteLength < 12) {
    throw new Error('File is too small to be a font (missing sfnt header).')
  }
  const view = new DataView(buffer)
  let base = 0
  let sfntVersion = view.getUint32(0)

  if (sfntVersion === SFNT_VERSION_TTCF) {
    // TrueType Collection: use the first font in the collection.
    if (buffer.byteLength < 16) {
      throw new Error('Truncated TrueType Collection header.')
    }
    base = view.getUint32(12)
    if (base + 12 > buffer.byteLength) {
      throw new Error('TrueType Collection points outside the file.')
    }
    sfntVersion = view.getUint32(base)
  }

  if (!isKnownSfntVersion(sfntVersion)) {
    throw new Error(
      `Unrecognised sfnt version 0x${sfntVersion.toString(16).padStart(8, '0')}.`,
    )
  }

  const numTables = view.getUint16(base + 4)
  const dirEnd = base + 12 + numTables * 16
  if (dirEnd > buffer.byteLength) {
    throw new Error('Truncated table directory.')
  }

  const tables: SfntTable[] = []
  for (let i = 0; i < numTables; i += 1) {
    const entry = base + 12 + i * 16
    const tag = readTag(view, entry)
    const checksum = view.getUint32(entry + 4)
    const offset = view.getUint32(entry + 8)
    const length = view.getUint32(entry + 12)
    if (offset > buffer.byteLength) {
      // Skip clearly bogus entries rather than failing the whole import.
      continue
    }
    tables.push({
      tag,
      checksum,
      offset,
      length: Math.min(length, buffer.byteLength - offset),
    })
  }
  return { sfntVersion, tables }
}

export function getTableData(
  buffer: ArrayBuffer,
  table: SfntTable,
): Uint8Array {
  return new Uint8Array(buffer, table.offset, table.length)
}

export function findTable(
  directory: SfntDirectory,
  tag: string,
): SfntTable | undefined {
  return directory.tables.find((t) => t.tag === tag)
}

/** sfnt table checksum: sum of big-endian uint32s, zero-padded to 4 bytes. */
export function calcTableChecksum(data: Uint8Array): number {
  let sum = 0
  const n = data.length
  const full = n & ~3
  for (let i = 0; i < full; i += 4) {
    sum =
      (sum +
        (((data[i] << 24) |
          (data[i + 1] << 16) |
          (data[i + 2] << 8) |
          data[i + 3]) >>>
          0)) >>>
      0
  }
  if (full < n) {
    let tail = 0
    for (let i = 0; i < 4; i += 1) {
      tail = ((tail << 8) | (full + i < n ? data[full + i] : 0)) >>> 0
    }
    sum = (sum + tail) >>> 0
  }
  return sum >>> 0
}

export interface CollectionInfo {
  numFonts: number
  offsets: number[]
}

export function readCollectionHeader(buffer: ArrayBuffer): CollectionInfo | null {
  if (buffer.byteLength < 12) return null
  const view = new DataView(buffer)
  if (view.getUint32(0) !== SFNT_VERSION_TTCF) return null
  const numFonts = view.getUint32(8)
  if (numFonts === 0 || 12 + numFonts * 4 > buffer.byteLength) return null
  const offsets: number[] = []
  for (let i = 0; i < numFonts; i += 1) {
    offsets.push(view.getUint32(12 + i * 4))
  }
  return { numFonts, offsets }
}

/**
 * Lifts one font out of a TrueType Collection into a standalone sfnt.
 *
 * Collection members share table data by pointing at the same byte ranges,
 * so the extracted font copies those ranges into a fresh container rather
 * than trying to reuse the collection's directory.
 */
export function extractFontFromCollection(
  buffer: ArrayBuffer,
  fontIndex = 0,
): ArrayBuffer {
  const header = readCollectionHeader(buffer)
  if (!header) throw new Error('Not a TrueType Collection.')
  const offset = header.offsets[Math.min(fontIndex, header.numFonts - 1)]
  if (offset === undefined || offset + 12 > buffer.byteLength) {
    throw new Error('TrueType Collection entry points outside the file.')
  }

  const view = new DataView(buffer)
  const sfntVersion = view.getUint32(offset)
  if (!isKnownSfntVersion(sfntVersion)) {
    throw new Error('TrueType Collection entry has an unrecognised sfnt version.')
  }
  const numTables = view.getUint16(offset + 4)
  const tables: TableToWrite[] = []
  for (let i = 0; i < numTables; i += 1) {
    const entry = offset + 12 + i * 16
    if (entry + 16 > buffer.byteLength) break
    const tag = readTag(view, entry)
    const tableOffset = view.getUint32(entry + 8)
    const length = view.getUint32(entry + 12)
    if (tableOffset + length > buffer.byteLength) continue
    tables.push({
      tag,
      data: new Uint8Array(buffer, tableOffset, length).slice(),
    })
  }
  if (tables.length === 0) {
    throw new Error('TrueType Collection entry contains no readable tables.')
  }
  return buildSfnt(sfntVersion, tables)
}

export interface TableToWrite {
  tag: string
  data: Uint8Array
}

/**
 * Assembles a complete sfnt file. Tables are written in tag order with
 * 4-byte padding, the search-range fields are computed per spec, and
 * head.checkSumAdjustment is patched last.
 */
export function buildSfnt(
  sfntVersion: number,
  tablesIn: TableToWrite[],
): ArrayBuffer {
  const tables = [...tablesIn].sort((a, b) => (a.tag < b.tag ? -1 : 1))
  const numTables = tables.length

  let entrySelector = 0
  while (1 << (entrySelector + 1) <= numTables) entrySelector += 1
  const searchRange = (1 << entrySelector) * 16
  const rangeShift = numTables * 16 - searchRange

  const headerSize = 12 + numTables * 16
  let total = headerSize
  const offsets: number[] = []
  for (const t of tables) {
    offsets.push(total)
    total += t.data.length
    total = (total + 3) & ~3
  }

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, sfntVersion >>> 0)
  view.setUint16(4, numTables)
  view.setUint16(6, searchRange)
  view.setUint16(8, entrySelector)
  view.setUint16(10, rangeShift)

  let headEntryOffset = -1
  let headDataOffset = -1
  for (let i = 0; i < numTables; i += 1) {
    const t = tables[i]
    const entry = 12 + i * 16
    view.setUint32(entry, tagToUint32(t.tag))
    view.setUint32(entry + 4, calcTableChecksum(t.data))
    view.setUint32(entry + 8, offsets[i])
    view.setUint32(entry + 12, t.data.length)
    out.set(t.data, offsets[i])
    if (t.tag === 'head') {
      headEntryOffset = entry
      headDataOffset = offsets[i]
    }
  }

  if (headDataOffset >= 0) {
    // checkSumAdjustment must be zero while the whole-file checksum is taken.
    view.setUint32(headDataOffset + 8, 0)
    view.setUint32(
      headEntryOffset + 4,
      calcTableChecksum(
        out.subarray(headDataOffset, headDataOffset + tables.find((t) => t.tag === 'head')!.data.length),
      ),
    )
    const fileChecksum = calcTableChecksum(out)
    view.setUint32(headDataOffset + 8, (0xb1b0afba - fileChecksum) >>> 0)
  }

  return out.buffer
}
