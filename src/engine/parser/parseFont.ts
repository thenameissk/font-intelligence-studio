/**
 * Import pipeline: file bytes -> ParsedFont.
 *
 * `ParsedFont` is immutable and represents the font exactly as imported.
 * All user edits live in a separate overlay (see glyphAccess.ts), so the
 * original data is always available for export and for "revert to original".
 */
import { parse as parseOpenType, type Font as OTFont, type Glyph as OTGlyph } from 'opentype.js'
import type {
  FontMetadata,
  GlyphIndexEntry,
  ImportWarning,
  SourceGlyph,
  VerticalMetrics,
} from '@/types/font'
import type { Outline } from '@/types/geometry'
import { commandsToOutline } from '@/engine/geometry/outline'
import { decodeFontFile } from './decode'
import { extractMetadata, extractVerticalMetrics } from './metadata'
import { sanitizeForParsing } from './sanitize'
import { readTableDirectory, type SfntDirectory } from './sfnt'
import { categorizeCodepoint, codepointToDisplayChar } from './unicode'

export interface ParsedFont {
  /** The exact bytes the user imported. Never mutated. */
  readonly originalFile: ArrayBuffer
  /** The sfnt bytes (identical to `originalFile` unless WOFF/WOFF2). */
  readonly sfnt: ArrayBuffer
  readonly directory: SfntDirectory
  readonly otFont: OTFont
  readonly metadata: FontMetadata
  readonly verticalMetrics: VerticalMetrics
  readonly glyphs: readonly SourceGlyph[]
  readonly index: readonly GlyphIndexEntry[]
  /** Code point -> glyph index, from cmap. */
  readonly cmap: ReadonlyMap<number, number>
  /** Glyph name -> glyph index. */
  readonly namesToIndex: ReadonlyMap<string, number>
  readonly warnings: readonly ImportWarning[]
  /** Lazily decoded source outlines, memoised. */
  sourceOutline(glyphIndex: number): Outline
}

function safeGlyph(font: OTFont, index: number): OTGlyph | null {
  try {
    return font.glyphs.get(index)
  } catch {
    return null
  }
}

function glyphIsComposite(glyph: OTGlyph): boolean {
  if (typeof glyph.numberOfContours === 'number' && glyph.numberOfContours < 0) {
    return true
  }
  return Array.isArray(glyph.components) && glyph.components.length > 0
}

function buildCmap(font: OTFont): Map<number, number> {
  const map = new Map<number, number>()
  const raw = font.tables.cmap?.glyphIndexMap
  if (!raw) return map
  for (const key of Object.keys(raw)) {
    const codepoint = Number(key)
    if (Number.isFinite(codepoint)) map.set(codepoint, raw[key])
  }
  return map
}

export async function parseFontFile(
  file: { name: string; buffer: ArrayBuffer },
): Promise<ParsedFont> {
  const decoded = await decodeFontFile(file.buffer)
  const warnings: ImportWarning[] = [...decoded.warnings]

  const directory = readTableDirectory(decoded.sfnt)

  // Parsing may need a lightly repaired copy; `decoded.sfnt` stays pristine
  // so the exporter can still write the font's original table bytes.
  const sanitized = sanitizeForParsing(decoded.sfnt)
  warnings.push(...sanitized.warnings)

  let otFont: OTFont
  try {
    otFont = parseOpenType(sanitized.buffer)
  } catch (error) {
    throw new Error(
      `This font could not be parsed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (!otFont.supported) {
    warnings.push({
      severity: 'warning',
      message: 'The parser reported this font as only partially supported.',
    })
  }

  const metadata = extractMetadata(otFont, directory, {
    container: decoded.container,
    fileName: file.name,
    fileSize: file.buffer.byteLength,
  })
  const verticalMetrics = extractVerticalMetrics(otFont)

  if (metadata.outlineFormat === 'cff2') {
    warnings.push({
      severity: 'warning',
      message:
        'This font uses CFF2 outlines. Glyph geometry is read-only and export is disabled.',
    })
  }
  if (metadata.isVariable) {
    warnings.push({
      severity: 'info',
      message: `Variable font with ${metadata.axes.length} axis${
        metadata.axes.length === 1 ? '' : 'es'
      }. Editing applies to the default instance only.`,
    })
  }
  if (verticalMetrics.unitsPerEm <= 0) {
    warnings.push({
      severity: 'error',
      message: 'head.unitsPerEm is invalid; metrics will be unreliable.',
    })
  }

  const cmap = buildCmap(otFont)
  const reverseCmap = new Map<number, number[]>()
  for (const [codepoint, glyphIndex] of cmap) {
    const list = reverseCmap.get(glyphIndex)
    if (list) list.push(codepoint)
    else reverseCmap.set(glyphIndex, [codepoint])
  }

  const glyphs: SourceGlyph[] = []
  const namesToIndex = new Map<string, number>()
  let unreadable = 0

  for (let i = 0; i < otFont.numGlyphs; i += 1) {
    const glyph = safeGlyph(otFont, i)
    if (!glyph) {
      unreadable += 1
      glyphs.push({
        index: i,
        name: `glyph${i}`,
        unicode: null,
        unicodes: [],
        advanceWidth: 0,
        leftSideBearing: 0,
        isComposite: false,
      })
      continue
    }
    const unicodes = (reverseCmap.get(i) ?? []).sort((a, b) => a - b)
    const name = glyph.name ?? `glyph${i}`
    if (!namesToIndex.has(name)) namesToIndex.set(name, i)
    glyphs.push({
      index: i,
      name,
      unicode: unicodes.length > 0 ? unicodes[0] : (glyph.unicode ?? null),
      unicodes,
      advanceWidth: Number.isFinite(glyph.advanceWidth) ? glyph.advanceWidth : 0,
      leftSideBearing: Number.isFinite(glyph.leftSideBearing)
        ? glyph.leftSideBearing
        : 0,
      isComposite: glyphIsComposite(glyph),
    })
  }

  if (unreadable > 0) {
    warnings.push({
      severity: 'warning',
      message: `${unreadable} glyph${unreadable === 1 ? '' : 's'} could not be read and will show as empty.`,
    })
  }

  const outlineCache = new Map<number, Outline>()
  const sourceOutline = (glyphIndex: number): Outline => {
    const cached = outlineCache.get(glyphIndex)
    if (cached) return cached
    const glyph = safeGlyph(otFont, glyphIndex)
    let outline: Outline = { contours: [] }
    if (glyph) {
      try {
        outline = commandsToOutline(glyph.path.commands)
      } catch {
        outline = { contours: [] }
      }
    }
    outlineCache.set(glyphIndex, outline)
    return outline
  }

  const index: GlyphIndexEntry[] = glyphs.map((glyph) => ({
    index: glyph.index,
    name: glyph.name,
    unicode: glyph.unicode,
    category: categorizeCodepoint(glyph.unicode),
    char: codepointToDisplayChar(glyph.unicode),
    // Cheap emptiness probe: a glyph with no contours draws nothing.
    isEmpty: isProbablyEmpty(otFont, glyph.index),
  }))

  return {
    originalFile: file.buffer,
    sfnt: decoded.sfnt,
    directory,
    otFont,
    metadata,
    verticalMetrics,
    glyphs,
    index,
    cmap,
    namesToIndex,
    warnings,
    sourceOutline,
  }
}

/**
 * Emptiness check that avoids decoding outlines for the whole font:
 * TrueType exposes a contour count directly, CFF needs the path.
 */
function isProbablyEmpty(font: OTFont, glyphIndex: number): boolean {
  const glyph = safeGlyph(font, glyphIndex)
  if (!glyph) return true
  if (typeof glyph.numberOfContours === 'number') {
    return glyph.numberOfContours === 0
  }
  try {
    return glyph.path.commands.length === 0
  } catch {
    return true
  }
}
