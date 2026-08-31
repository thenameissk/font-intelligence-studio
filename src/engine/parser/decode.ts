/**
 * Container decoding: turns whatever file the user dropped into a plain
 * sfnt byte buffer that the rest of the engine can parse.
 *
 * The original bytes are never mutated; WOFF/WOFF2 inputs are unwrapped
 * into a new buffer and the original is retained alongside it.
 */
import { inflate, supportsCompressionStreams } from '@/utils/compression'
import type { FontContainer, ImportWarning } from '@/types/font'
import {
  buildSfnt,
  extractFontFromCollection,
  readCollectionHeader,
  readTag,
  SFNT_VERSION_TTCF,
  WOFF2_SIGNATURE,
  WOFF_SIGNATURE,
  isKnownSfntVersion,
  type TableToWrite,
} from './sfnt'

export interface DecodedContainer {
  /** Plain sfnt bytes, ready for table-directory parsing. */
  sfnt: ArrayBuffer
  container: FontContainer
  warnings: ImportWarning[]
  /**
   * True when `sfnt` is byte-identical to the imported file, meaning the
   * exporter can reuse original table bytes directly.
   */
  isOriginalSfnt: boolean
}

export function detectContainer(buffer: ArrayBuffer): FontContainer | null {
  if (buffer.byteLength < 4) return null
  const signature = new DataView(buffer).getUint32(0)
  if (signature === WOFF_SIGNATURE) return 'woff'
  if (signature === WOFF2_SIGNATURE) return 'woff2'
  if (signature === SFNT_VERSION_TTCF) return 'ttc'
  if (isKnownSfntVersion(signature)) return 'sfnt'
  return null
}

async function decodeWoff(buffer: ArrayBuffer): Promise<{
  sfnt: ArrayBuffer
  warnings: ImportWarning[]
}> {
  if (!supportsCompressionStreams()) {
    throw new Error(
      'This browser cannot decompress WOFF fonts (Compression Streams API unavailable).',
    )
  }
  const view = new DataView(buffer)
  if (buffer.byteLength < 44) throw new Error('Truncated WOFF header.')

  const flavor = view.getUint32(4)
  const numTables = view.getUint16(12)
  const warnings: ImportWarning[] = []

  const dirEnd = 44 + numTables * 20
  if (dirEnd > buffer.byteLength) throw new Error('Truncated WOFF directory.')

  const tables: TableToWrite[] = []
  for (let i = 0; i < numTables; i += 1) {
    const entry = 44 + i * 20
    const tag = readTag(view, entry)
    const offset = view.getUint32(entry + 4)
    const compLength = view.getUint32(entry + 8)
    const origLength = view.getUint32(entry + 12)
    if (offset + compLength > buffer.byteLength) {
      warnings.push({
        severity: 'warning',
        message: `WOFF table '${tag}' extends past end of file and was skipped.`,
      })
      continue
    }
    const raw = new Uint8Array(buffer, offset, compLength)
    let data: Uint8Array
    if (compLength < origLength) {
      data = await inflate(raw)
      if (data.length !== origLength) {
        warnings.push({
          severity: 'warning',
          message: `WOFF table '${tag}' decompressed to ${data.length} bytes, expected ${origLength}.`,
        })
      }
    } else {
      data = raw.slice()
    }
    tables.push({ tag, data })
  }

  if (view.getUint32(28) > 0) {
    warnings.push({
      severity: 'info',
      message: 'WOFF extended metadata block was not carried over.',
    })
  }

  return { sfnt: buildSfnt(flavor, tables), warnings }
}

async function decodeWoff2(buffer: ArrayBuffer): Promise<{
  sfnt: ArrayBuffer
  warnings: ImportWarning[]
}> {
  // ~300 KB of WebAssembly -- only pulled in when a WOFF2 is actually opened.
  const { decompress } = await import('woff2-encoder')
  const decoded = await decompress(buffer)
  const copy = new Uint8Array(decoded.length)
  copy.set(decoded)
  return {
    sfnt: copy.buffer,
    warnings: [
      {
        severity: 'info',
        message:
          'WOFF2 was decompressed to a plain sfnt. Re-compressing on export is lossy for hinting-sensitive fonts.',
      },
    ],
  }
}

export async function decodeFontFile(
  buffer: ArrayBuffer,
): Promise<DecodedContainer> {
  const container = detectContainer(buffer)
  if (container === null) {
    throw new Error(
      'Unrecognised file format. Expected TTF, OTF, WOFF, WOFF2 or TTC.',
    )
  }

  switch (container) {
    case 'woff': {
      const { sfnt, warnings } = await decodeWoff(buffer)
      return { sfnt, container, warnings, isOriginalSfnt: false }
    }
    case 'woff2': {
      const { sfnt, warnings } = await decodeWoff2(buffer)
      return { sfnt, container, warnings, isOriginalSfnt: false }
    }
    case 'ttc': {
      const header = readCollectionHeader(buffer)
      return {
        sfnt: extractFontFromCollection(buffer, 0),
        container,
        isOriginalSfnt: false,
        warnings: [
          {
            severity: 'warning',
            message: `This file is a collection of ${header?.numFonts ?? 'several'} fonts. The first one was opened; the others are not accessible in this version.`,
          },
        ],
      }
    }
    default:
      return { sfnt: buffer, container, warnings: [], isOriginalSfnt: true }
  }
}
