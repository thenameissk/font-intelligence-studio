/**
 * CFF (Type 2) table writing, for exporting OTF fonts with edited outlines.
 *
 * The parser we use can read CFF but only writes a whole font from scratch,
 * which would throw away GPOS, GDEF and everything else we want to keep. So
 * the exporter builds the CFF table itself and drops it into the original
 * sfnt alongside the untouched tables.
 *
 * The output is deliberately plain: no subroutines, no hinting, no encoding
 * table (an OTF gets its encoding from cmap). Glyph names go into the String
 * INDEX as custom strings, which is spec-legal and avoids depending on the
 * 391 standard strings matching this font's glyph set.
 */
import type { Outline, Rect } from '@/types/geometry'
import { contourSegments } from '@/engine/geometry/outline'

// --------------------------------------------------------------------------
// Primitive encoders
// --------------------------------------------------------------------------

/** Type 2 charstring integer encoding. */
function encodeCharstringNumber(value: number): number[] {
  const v = Math.round(value)
  if (v >= -107 && v <= 107) return [v + 139]
  if (v >= 108 && v <= 1131) {
    const d = v - 108
    return [(d >> 8) + 247, d & 0xff]
  }
  if (v <= -108 && v >= -1131) {
    const d = -v - 108
    return [(d >> 8) + 251, d & 0xff]
  }
  if (v >= -32768 && v <= 32767) return [28, (v >> 8) & 0xff, v & 0xff]
  // 16.16 fixed, the only way to carry a value this large.
  const fixed = Math.round(v * 65536)
  return [255, (fixed >> 24) & 0xff, (fixed >> 16) & 0xff, (fixed >> 8) & 0xff, fixed & 0xff]
}

/** DICT integer encoding. */
function encodeDictNumber(value: number): number[] {
  const v = Math.round(value)
  if (v >= -107 && v <= 107) return [v + 139]
  if (v >= 108 && v <= 1131) {
    const d = v - 108
    return [(d >> 8) + 247, d & 0xff]
  }
  if (v <= -108 && v >= -1131) {
    const d = -v - 108
    return [(d >> 8) + 251, d & 0xff]
  }
  if (v >= -32768 && v <= 32767) return [28, (v >> 8) & 0xff, v & 0xff]
  return [29, (v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

/**
 * A 32-bit DICT operand written at full width even when it would fit in
 * fewer bytes. Offsets inside the Top DICT point at data that comes after
 * the Top DICT itself, so its encoded size has to stay fixed while those
 * offsets are computed.
 */
function encodeFixedWidthOffset(value: number): number[] {
  const v = Math.round(value)
  return [29, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}

function encodeOperator(operator: number): number[] {
  return operator >= 1200 ? [12, operator - 1200] : [operator]
}

/** Builds a CFF INDEX from a list of byte blobs. */
function buildIndex(items: readonly Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0])

  const dataLength = items.reduce((sum, item) => sum + item.length, 0)
  const lastOffset = dataLength + 1
  const offSize =
    lastOffset <= 0xff ? 1 : lastOffset <= 0xffff ? 2 : lastOffset <= 0xffffff ? 3 : 4

  const size = 2 + 1 + (items.length + 1) * offSize + dataLength
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)

  view.setUint16(0, items.length)
  out[2] = offSize

  let offset = 1
  let cursor = 3
  const writeOffset = (value: number): void => {
    for (let i = offSize - 1; i >= 0; i -= 1) {
      out[cursor++] = (value >>> (i * 8)) & 0xff
    }
  }

  writeOffset(offset)
  for (const item of items) {
    offset += item.length
    writeOffset(offset)
  }

  let dataCursor = cursor
  for (const item of items) {
    out.set(item, dataCursor)
    dataCursor += item.length
  }

  return out
}

// --------------------------------------------------------------------------
// Charstrings
// --------------------------------------------------------------------------

const OP_RMOVETO = 21
const OP_RLINETO = 5
const OP_RRCURVETO = 8
const OP_ENDCHAR = 14

/** Type 2 allows 48 arguments on the stack; stay well inside that. */
const MAX_LINE_PAIRS = 20
const MAX_CURVE_GROUPS = 6

/**
 * Encodes one glyph as a Type 2 charstring.
 *
 * All coordinates are relative to the current point and rounded to integers,
 * which is what the format stores. The advance width is written as the
 * leading odd argument so the charstring is self-describing even though
 * hmtx is what renderers actually read for an OTF.
 */
export function encodeCharstring(
  outline: Outline,
  advanceWidth: number,
  nominalWidthX = 0,
  defaultWidthX = 0,
): Uint8Array {
  const bytes: number[] = []
  const push = (values: number[]): void => {
    for (const value of values) bytes.push(value)
  }

  const width = Math.round(advanceWidth)
  let widthPending = width !== defaultWidthX
  const emitWidth = (): void => {
    if (!widthPending) return
    push(encodeCharstringNumber(width - nominalWidthX))
    widthPending = false
  }

  let penX = 0
  let penY = 0

  for (const contour of outline.contours) {
    const segments = contourSegments(contour)
    if (segments.length === 0) continue

    const start = segments[0].from
    const startX = Math.round(start.x)
    const startY = Math.round(start.y)

    // The width rides along with the first stack-clearing operator.
    emitWidth()
    push(encodeCharstringNumber(startX - penX))
    push(encodeCharstringNumber(startY - penY))
    push(encodeOperator(OP_RMOVETO))
    penX = startX
    penY = startY

    let index = 0
    while (index < segments.length) {
      const segment = segments[index]

      if (segment.kind === 'line') {
        const args: number[] = []
        let count = 0
        while (
          index < segments.length &&
          segments[index].kind === 'line' &&
          count < MAX_LINE_PAIRS
        ) {
          const to = segments[index].to
          const x = Math.round(to.x)
          const y = Math.round(to.y)
          args.push(...encodeCharstringNumber(x - penX))
          args.push(...encodeCharstringNumber(y - penY))
          penX = x
          penY = y
          index += 1
          count += 1
        }
        push(args)
        push(encodeOperator(OP_RLINETO))
        continue
      }

      const args: number[] = []
      let count = 0
      while (
        index < segments.length &&
        segments[index].kind === 'cubic' &&
        count < MAX_CURVE_GROUPS
      ) {
        const current = segments[index]
        if (current.kind !== 'cubic') break
        const c1x = Math.round(current.c1.x)
        const c1y = Math.round(current.c1.y)
        const c2x = Math.round(current.c2.x)
        const c2y = Math.round(current.c2.y)
        const toX = Math.round(current.to.x)
        const toY = Math.round(current.to.y)

        args.push(...encodeCharstringNumber(c1x - penX))
        args.push(...encodeCharstringNumber(c1y - penY))
        args.push(...encodeCharstringNumber(c2x - c1x))
        args.push(...encodeCharstringNumber(c2y - c1y))
        args.push(...encodeCharstringNumber(toX - c2x))
        args.push(...encodeCharstringNumber(toY - c2y))

        penX = toX
        penY = toY
        index += 1
        count += 1
      }
      push(args)
      push(encodeOperator(OP_RRCURVETO))
    }
  }

  // An empty glyph still needs its width, carried by endchar.
  emitWidth()
  push(encodeOperator(OP_ENDCHAR))
  return new Uint8Array(bytes)
}

// --------------------------------------------------------------------------
// Table assembly
// --------------------------------------------------------------------------

export interface CffGlyph {
  name: string
  outline: Outline
  advanceWidth: number
}

export interface CffBuildInput {
  fontName: string
  glyphs: readonly CffGlyph[]
  fontBBox: Rect
}

function ascii(text: string): Uint8Array {
  const safe = text.replace(/[^\x20-\x7e]/g, '')
  const out = new Uint8Array(safe.length)
  for (let i = 0; i < safe.length; i += 1) out[i] = safe.charCodeAt(i)
  return out
}

/** Format 0 charset: one SID per glyph, excluding .notdef. */
function buildCharset(sids: readonly number[]): Uint8Array {
  const out = new Uint8Array(1 + sids.length * 2)
  const view = new DataView(out.buffer)
  out[0] = 0
  sids.forEach((sid, index) => view.setUint16(1 + index * 2, sid))
  return out
}

function buildPrivateDict(): Uint8Array {
  const bytes: number[] = []
  // defaultWidthX = 0, nominalWidthX = 0: charstrings carry widths verbatim.
  bytes.push(...encodeDictNumber(0), ...encodeOperator(20))
  bytes.push(...encodeDictNumber(0), ...encodeOperator(21))
  return new Uint8Array(bytes)
}

export function buildCff(input: CffBuildInput): Uint8Array {
  const { glyphs } = input
  if (glyphs.length === 0) throw new Error('A CFF font needs at least .notdef.')

  // Glyph names become custom strings; SIDs start after the 391 standard
  // strings. Glyph 0 is .notdef and is not listed in the charset.
  const strings: Uint8Array[] = []
  const sids: number[] = []
  for (let index = 1; index < glyphs.length; index += 1) {
    strings.push(ascii(glyphs[index].name || `glyph${index}`))
    sids.push(391 + strings.length - 1)
  }

  const charstrings = glyphs.map((glyph) =>
    encodeCharstring(glyph.outline, glyph.advanceWidth),
  )

  const nameIndex = buildIndex([ascii(input.fontName || 'Untitled')])
  const stringIndex = buildIndex(strings)
  const globalSubrIndex = buildIndex([])
  const charsetData = buildCharset(sids)
  const charStringsIndex = buildIndex(charstrings)
  const privateDict = buildPrivateDict()

  // Top DICT with fixed-width offset operands, so its size does not change
  // once the real offsets are substituted in.
  const buildTopDict = (
    charsetOffset: number,
    charStringsOffset: number,
    privateOffset: number,
  ): Uint8Array => {
    const bytes: number[] = []
    // FontBBox
    bytes.push(...encodeDictNumber(Math.round(input.fontBBox.xMin)))
    bytes.push(...encodeDictNumber(Math.round(input.fontBBox.yMin)))
    bytes.push(...encodeDictNumber(Math.round(input.fontBBox.xMax)))
    bytes.push(...encodeDictNumber(Math.round(input.fontBBox.yMax)))
    bytes.push(...encodeOperator(5))
    // charset
    bytes.push(...encodeFixedWidthOffset(charsetOffset), ...encodeOperator(15))
    // CharStrings
    bytes.push(
      ...encodeFixedWidthOffset(charStringsOffset),
      ...encodeOperator(17),
    )
    // Private [size, offset]
    bytes.push(...encodeDictNumber(privateDict.length))
    bytes.push(...encodeFixedWidthOffset(privateOffset), ...encodeOperator(18))
    return new Uint8Array(bytes)
  }

  // First pass with placeholder offsets fixes the Top DICT's size.
  const placeholder = buildTopDict(0, 0, 0)
  const topDictIndexSize = buildIndex([placeholder]).length

  const headerSize = 4
  const charsetOffset =
    headerSize +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length +
    globalSubrIndex.length
  const charStringsOffset = charsetOffset + charsetData.length
  const privateOffset = charStringsOffset + charStringsIndex.length

  const topDictIndex = buildIndex([
    buildTopDict(charsetOffset, charStringsOffset, privateOffset),
  ])
  if (topDictIndex.length !== topDictIndexSize) {
    throw new Error('CFF Top DICT changed size while offsets were computed.')
  }

  const total = privateOffset + privateDict.length
  const out = new Uint8Array(total)
  let cursor = 0

  // Header: major 1, minor 0, hdrSize 4, offSize 4.
  out.set([1, 0, 4, 4], cursor)
  cursor += headerSize

  const write = (data: Uint8Array): void => {
    out.set(data, cursor)
    cursor += data.length
  }
  write(nameIndex)
  write(topDictIndex)
  write(stringIndex)
  write(globalSubrIndex)
  write(charsetData)
  write(charStringsIndex)
  write(privateDict)

  return out
}
