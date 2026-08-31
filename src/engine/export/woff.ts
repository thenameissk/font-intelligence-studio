/**
 * WOFF 1.0 wrapping.
 *
 * Each table is deflated independently; a table is stored uncompressed when
 * compression would not make it smaller, which the format explicitly allows.
 */
import { deflate } from '@/utils/compression'
import { calcTableChecksum, readTableDirectory, tagToUint32 } from '@/engine/parser/sfnt'

const WOFF_SIGNATURE = 0x774f4646

export async function wrapWoff(sfnt: ArrayBuffer): Promise<ArrayBuffer> {
  const directory = readTableDirectory(sfnt)
  const tables = [...directory.tables].sort((a, b) => (a.tag < b.tag ? -1 : 1))

  const entries: Array<{
    tag: string
    data: Uint8Array
    originalLength: number
    checksum: number
  }> = []

  for (const table of tables) {
    const original = new Uint8Array(sfnt, table.offset, table.length)
    const compressed = await deflate(original)
    entries.push({
      tag: table.tag,
      data: compressed.length < original.length ? compressed : original.slice(),
      originalLength: original.length,
      checksum: calcTableChecksum(original),
    })
  }

  const headerSize = 44
  const directorySize = entries.length * 20
  let offset = headerSize + directorySize
  const placements = entries.map((entry) => {
    const start = offset
    offset += entry.data.length
    offset = (offset + 3) & ~3
    return start
  })

  const total = offset
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  // The uncompressed size the sfnt would occupy, per the spec.
  const totalSfntSize =
    12 +
    entries.length * 16 +
    entries.reduce((sum, entry) => sum + ((entry.originalLength + 3) & ~3), 0)

  view.setUint32(0, WOFF_SIGNATURE)
  view.setUint32(4, directory.sfntVersion >>> 0)
  view.setUint32(8, total)
  view.setUint16(12, entries.length)
  view.setUint16(14, 0)
  view.setUint32(16, totalSfntSize)
  view.setUint16(20, 1) // majorVersion
  view.setUint16(22, 0) // minorVersion
  view.setUint32(24, 0) // metaOffset
  view.setUint32(28, 0) // metaLength
  view.setUint32(32, 0) // metaOrigLength
  view.setUint32(36, 0) // privOffset
  view.setUint32(40, 0) // privLength

  entries.forEach((entry, index) => {
    const record = headerSize + index * 20
    view.setUint32(record, tagToUint32(entry.tag))
    view.setUint32(record + 4, placements[index])
    view.setUint32(record + 8, entry.data.length)
    view.setUint32(record + 12, entry.originalLength)
    view.setUint32(record + 16, entry.checksum)
    out.set(entry.data, placements[index])
  })

  return out.buffer
}
