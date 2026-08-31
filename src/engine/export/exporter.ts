/**
 * Font export.
 *
 * The exporter rebuilds only the tables that the user's edits actually
 * affect and copies every other table out of the imported font byte for
 * byte. That is what keeps GPOS, GDEF, GSUB, layout metrics, colour tables
 * and anything else this application does not model intact, instead of
 * silently dropping them the way a full re-encode would.
 *
 * Cross-flavour conversion (TrueType outlines to CFF, or the reverse) is
 * supported, but it re-encodes every glyph and drops format-specific
 * hinting, so it is reported clearly rather than done quietly.
 */
import type { GlyphEdits, ImportWarning } from '@/types/font'
import type { Outline, Rect } from '@/types/geometry'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import {
  buildSfnt,
  findTable,
  SFNT_VERSION_OTTO,
  SFNT_VERSION_TRUETYPE,
  type TableToWrite,
} from '@/engine/parser/sfnt'
import { mergedKerningPairs } from '@/engine/typography/kerning'
import { buildCff } from './cff'
import { buildGlyf } from './glyf'
import {
  buildHmtx,
  buildKern,
  buildMaxpCff,
  buildMaxpTrueType,
  patchHead,
  patchHhea,
  patchOs2,
  MAX_KERN_PAIRS,
  type GlyphMetric,
} from './tables'

export const EXPORT_FORMAT = {
  OTF: 'otf',
  TTF: 'ttf',
  WOFF: 'woff',
  WOFF2: 'woff2',
} as const
export type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT]

export const OUTLINE_TARGET = {
  /** Keep whatever the imported font used. */
  Source: 'source',
  TrueType: 'truetype',
  CFF: 'cff',
} as const
export type OutlineTarget = (typeof OUTLINE_TARGET)[keyof typeof OUTLINE_TARGET]

export interface ExportOptions {
  format: ExportFormat
  outlines?: OutlineTarget
  /** Write a legacy kern table from the merged kerning. */
  includeKerning?: boolean
  /** Curve fitting tolerance in font units, for cubic to quadratic. */
  tolerance?: number
}

export interface ExportResult {
  data: ArrayBuffer
  fileName: string
  mimeType: string
  warnings: ImportWarning[]
  stats: {
    bytes: number
    glyphCount: number
    editedGlyphs: number
    reEncodedGlyphs: number
    preservedTables: string[]
    rebuiltTables: string[]
    droppedTables: string[]
  }
}

/** Tables that only make sense alongside TrueType outlines. */
const TRUETYPE_ONLY = new Set(['glyf', 'loca', 'cvt ', 'fpgm', 'prep', 'gasp'])
/** Tables that only make sense alongside CFF outlines. */
const CFF_ONLY = new Set(['CFF ', 'CFF2', 'VORG'])
/** A digital signature cannot survive the font being modified. */
const ALWAYS_DROP = new Set(['DSIG'])

const MIME: Record<ExportFormat, string> = {
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

function resolveOutlineTarget(
  parsed: ParsedFont,
  options: ExportOptions,
): 'truetype' | 'cff' {
  const requested = options.outlines ?? OUTLINE_TARGET.Source
  if (requested === OUTLINE_TARGET.TrueType) return 'truetype'
  if (requested === OUTLINE_TARGET.CFF) return 'cff'
  // "Source" follows the imported font, except that the container format
  // implies a flavour when the user picked OTF or TTF explicitly.
  if (options.format === EXPORT_FORMAT.TTF) return 'truetype'
  if (options.format === EXPORT_FORMAT.OTF) return 'cff'
  return parsed.metadata.outlineFormat === 'truetype' ? 'truetype' : 'cff'
}

export async function exportFont(
  parsed: ParsedFont,
  edits: GlyphEdits,
  kerningEdits: Readonly<Record<string, number>>,
  options: ExportOptions,
): Promise<ExportResult> {
  const warnings: ImportWarning[] = []
  const rebuilt: string[] = []
  const dropped: string[] = []

  if (parsed.metadata.outlineFormat === 'cff2') {
    throw new Error(
      'CFF2 fonts are read-only in this version. Export is not available.',
    )
  }

  const target = resolveOutlineTarget(parsed, options)
  const sourceFormat = parsed.metadata.outlineFormat
  const converting = target !== sourceFormat
  const editedIndices = new Set(Object.keys(edits).map(Number))

  if (converting) {
    warnings.push({
      severity: 'warning',
      message:
        target === 'truetype'
          ? 'Converting PostScript outlines to TrueType re-fits every curve as quadratics and drops CFF hinting.'
          : 'Converting TrueType outlines to PostScript re-encodes every glyph, drops TrueType hinting, and decomposes composite glyphs.',
    })
  }

  if (parsed.metadata.isVariable && editedIndices.size > 0) {
    warnings.push({
      severity: 'warning',
      message:
        'This is a variable font. The variation data is preserved unchanged, so edited glyphs will not vary correctly along the axes.',
    })
  }

  // ---- Resolve metrics and outlines -------------------------------------
  const glyphCount = parsed.glyphs.length
  const metrics: GlyphMetric[] = []
  const resolvedOutlines: Array<Outline | null> = []
  let reEncoded = 0

  for (let index = 0; index < glyphCount; index += 1) {
    const glyph = resolveGlyph(parsed, edits, index)
    metrics.push({
      advanceWidth: glyph.advanceWidth,
      leftSideBearing: glyph.isEmpty ? 0 : glyph.bounds.xMin,
    })
    // A glyph is re-encoded when it was edited, or when the whole font is
    // being converted to the other outline flavour.
    const needsEncoding = converting || editedIndices.has(index)
    resolvedOutlines.push(needsEncoding ? glyph.outline : null)
    if (needsEncoding) reEncoded += 1
  }

  // ---- Build the replacement tables -------------------------------------
  const replacements = new Map<string, Uint8Array>()
  let fontBounds: Rect = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  let indexToLocFormat: 0 | 1 = 0
  let maxPoints = 0
  let maxContours = 0

  const originalGlyf = findTable(parsed.directory, 'glyf')
  const originalLoca = findTable(parsed.directory, 'loca')

  if (target === 'truetype') {
    const locaOffsets = readLoca(parsed, originalLoca)
    const built = buildGlyf({
      glyphCount,
      tolerance: options.tolerance,
      originalBytes: (index) => {
        if (!originalGlyf || !locaOffsets) return null
        const start = locaOffsets[index]
        const end = locaOffsets[index + 1]
        if (start === undefined || end === undefined || end <= start) return null
        if (originalGlyf.offset + end > parsed.sfnt.byteLength) return null
        return new Uint8Array(
          parsed.sfnt,
          originalGlyf.offset + start,
          end - start,
        )
      },
      editedOutline: (index) => resolvedOutlines[index],
    })

    replacements.set('glyf', built.glyf)
    replacements.set('loca', built.loca)
    rebuilt.push('glyf', 'loca')
    fontBounds = built.fontBounds
    indexToLocFormat = built.indexToLocFormat
    maxPoints = built.maxPoints
    maxContours = built.maxContours

    // Ink bounds come from the encoded glyphs so hmtx agrees with glyf.
    built.bounds.forEach((bounds, index) => {
      metrics[index].leftSideBearing = bounds ? bounds.xMin : 0
    })
  } else {
    const cffGlyphs = parsed.glyphs.map((glyph, index) => ({
      name: glyph.name,
      outline: resolvedOutlines[index] ?? parsed.sourceOutline(index),
      advanceWidth: metrics[index].advanceWidth,
    }))

    fontBounds = boundsOf(cffGlyphs.map((glyph) => glyph.outline))
    const cff = buildCff({
      fontName:
        parsed.metadata.names.postScriptName ??
        parsed.metadata.names.fontFamily ??
        'Untitled',
      glyphs: cffGlyphs,
      fontBBox: fontBounds,
    })
    replacements.set('CFF ', cff)
    rebuilt.push('CFF ')
  }

  replacements.set('hmtx', buildHmtx(metrics))
  rebuilt.push('hmtx')

  // ---- Patch the dependent tables ---------------------------------------
  const head = tableBytes(parsed, 'head')
  if (!head) throw new Error('This font has no head table and cannot be written.')
  replacements.set('head', patchHead(head, { bounds: fontBounds, indexToLocFormat }))
  rebuilt.push('head')

  const hhea = tableBytes(parsed, 'hhea')
  if (!hhea) throw new Error('This font has no hhea table and cannot be written.')
  const solid = metrics.filter((_, index) => {
    const outline = resolvedOutlines[index]
    return outline ? outline.contours.length > 0 : true
  })
  replacements.set(
    'hhea',
    patchHhea(hhea, {
      advanceWidthMax: Math.max(0, ...metrics.map((m) => m.advanceWidth)),
      minLeftSideBearing: Math.min(0, ...metrics.map((m) => m.leftSideBearing)),
      minRightSideBearing: 0,
      xMaxExtent: fontBounds.xMax,
      numberOfHMetrics: glyphCount,
    }),
  )
  rebuilt.push('hhea')
  void solid

  const maxp = tableBytes(parsed, 'maxp')
  replacements.set(
    'maxp',
    target === 'truetype'
      ? buildMaxpTrueType(converting ? null : maxp, {
          numGlyphs: glyphCount,
          maxPoints,
          maxContours,
        })
      : buildMaxpCff(glyphCount),
  )
  rebuilt.push('maxp')

  const os2 = tableBytes(parsed, 'OS/2')
  if (os2) {
    const encoded = metrics.filter((m) => m.advanceWidth > 0)
    const average =
      encoded.length > 0
        ? encoded.reduce((sum, m) => sum + m.advanceWidth, 0) / encoded.length
        : 0
    replacements.set('OS/2', patchOs2(os2, average))
    rebuilt.push('OS/2')
  }

  // ---- Kerning -----------------------------------------------------------
  const hasKerningEdits = Object.keys(kerningEdits).length > 0
  if (options.includeKerning !== false && hasKerningEdits) {
    const pairs = mergedKerningPairs(parsed, kerningEdits)
    const kern = buildKern(pairs)
    if (kern) {
      replacements.set('kern', kern)
      rebuilt.push('kern')
      if (pairs.length > MAX_KERN_PAIRS) {
        warnings.push({
          severity: 'warning',
          message: `Only the first ${MAX_KERN_PAIRS} kerning pairs were written; a format 0 kern subtable cannot hold more.`,
        })
      }
    }
    // Any GPOS table takes precedence over `kern` in practice, whether or
    // not it advertises a `kern` feature, so the presence of the table is
    // the honest test rather than the feature list.
    if (parsed.directory.tables.some((table) => table.tag === 'GPOS')) {
      warnings.push({
        severity: 'warning',
        message:
          'This font carries a GPOS table, which is preserved unchanged and which shapers consult before the legacy kern table. Your kerning changes are written to kern, so renderers that use GPOS will keep the original spacing.',
      })
    }
  }

  // ---- Assemble ----------------------------------------------------------
  const tables: TableToWrite[] = []
  const preserved: string[] = []

  for (const entry of parsed.directory.tables) {
    const tag = entry.tag
    if (ALWAYS_DROP.has(tag)) {
      dropped.push(tag)
      continue
    }
    if (target === 'cff' && TRUETYPE_ONLY.has(tag)) {
      dropped.push(tag)
      continue
    }
    if (target === 'truetype' && CFF_ONLY.has(tag)) {
      dropped.push(tag)
      continue
    }
    if (replacements.has(tag)) continue

    const data = tableBytes(parsed, tag)
    if (!data) continue
    tables.push({ tag, data })
    preserved.push(tag)
  }

  for (const [tag, data] of replacements) {
    tables.push({ tag, data })
  }

  if (dropped.length > 0) {
    warnings.push({
      severity: 'info',
      message: `Dropped ${dropped.join(', ')} because ${
        dropped.includes('DSIG') && dropped.length === 1
          ? 'the digital signature no longer matches the modified font'
          : 'they do not belong in this outline format'
      }.`,
    })
  }

  const sfntVersion =
    target === 'truetype' ? SFNT_VERSION_TRUETYPE : SFNT_VERSION_OTTO
  const sfnt = buildSfnt(sfntVersion, tables)

  // ---- Wrap in the requested container -----------------------------------
  const { data, extension } = await wrap(sfnt, options.format, warnings)

  const baseName = (
    parsed.metadata.names.postScriptName ??
    parsed.metadata.fileName.replace(/\.[^.]+$/, '')
  ).replace(/[^A-Za-z0-9._-]/g, '')

  return {
    data,
    fileName: `${baseName || 'font'}.${extension}`,
    mimeType: MIME[options.format],
    warnings,
    stats: {
      bytes: data.byteLength,
      glyphCount,
      editedGlyphs: editedIndices.size,
      reEncodedGlyphs: reEncoded,
      preservedTables: preserved.sort(),
      rebuiltTables: rebuilt.sort(),
      droppedTables: dropped.sort(),
    },
  }
}

async function wrap(
  sfnt: ArrayBuffer,
  format: ExportFormat,
  warnings: ImportWarning[],
): Promise<{ data: ArrayBuffer; extension: string }> {
  if (format === EXPORT_FORMAT.WOFF) {
    const { wrapWoff } = await import('./woff')
    return { data: await wrapWoff(sfnt), extension: 'woff' }
  }
  if (format === EXPORT_FORMAT.WOFF2) {
    try {
      const { compress } = await import('woff2-encoder')
      const compressed = await compress(sfnt)
      const copy = new Uint8Array(compressed.length)
      copy.set(compressed)
      return { data: copy.buffer, extension: 'woff2' }
    } catch (error) {
      warnings.push({
        severity: 'error',
        message: `WOFF2 compression failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
      throw error
    }
  }
  return { data: sfnt, extension: format }
}

function tableBytes(parsed: ParsedFont, tag: string): Uint8Array | null {
  const entry = findTable(parsed.directory, tag)
  if (!entry) return null
  if (entry.offset + entry.length > parsed.sfnt.byteLength) return null
  return new Uint8Array(parsed.sfnt, entry.offset, entry.length)
}

function readLoca(
  parsed: ParsedFont,
  loca: { offset: number; length: number } | undefined,
): number[] | null {
  if (!loca) return null
  const head = tableBytes(parsed, 'head')
  if (!head || head.length < 52) return null
  const longFormat =
    new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50) === 1

  const count = parsed.glyphs.length + 1
  const view = new DataView(parsed.sfnt, loca.offset, loca.length)
  const offsets: number[] = []
  for (let index = 0; index < count; index += 1) {
    if (longFormat) {
      if (index * 4 + 4 > loca.length) break
      offsets.push(view.getUint32(index * 4))
    } else {
      if (index * 2 + 2 > loca.length) break
      offsets.push(view.getUint16(index * 2) * 2)
    }
  }
  return offsets.length === count ? offsets : null
}

function boundsOf(outlines: readonly Outline[]): Rect {
  let result: Rect | null = null
  for (const outline of outlines) {
    for (const contour of outline.contours) {
      for (const node of contour.nodes) {
        const points = [node, node.in, node.out].filter(
          (p): p is { x: number; y: number } => p !== null && p !== undefined,
        )
        for (const point of points) {
          result = result
            ? {
                xMin: Math.min(result.xMin, point.x),
                yMin: Math.min(result.yMin, point.y),
                xMax: Math.max(result.xMax, point.x),
                yMax: Math.max(result.yMax, point.y),
              }
            : { xMin: point.x, yMin: point.y, xMax: point.x, yMax: point.y }
        }
      }
    }
  }
  return result ?? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
}
