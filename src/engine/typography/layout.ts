/**
 * Text layout for the typography preview.
 *
 * The preview draws real outlines from the edited font, not a browser
 * webfont, so a change to a glyph shows up in running text immediately.
 *
 * Shaping is deliberately modest: characters are mapped through cmap (with
 * the parser's own GSUB substitution when it can supply it, which gives
 * standard ligatures), then positioned with the font's kerning plus any
 * kerning the user has overridden. Complex scripts are not shaped, and the
 * UI says so rather than pretending otherwise.
 */
import type { GlyphEdits } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveAdvanceWidth } from '@/engine/parser/glyphAccess'

export interface PositionedGlyph {
  glyphIndex: number
  /** Pen position in font units, from the start of the line. */
  x: number
  advance: number
  /** Kerning applied before this glyph. */
  kerning: number
  char: string
}

export interface TextLine {
  glyphs: PositionedGlyph[]
  width: number
  /** Baseline position in font units, measured down from the first baseline. */
  baseline: number
  text: string
}

export interface TextLayout {
  lines: TextLine[]
  unitsPerEm: number
  /** Widest line, in font units. */
  width: number
  /** Total height in font units, first ascender to last descender. */
  height: number
  lineHeightUnits: number
  ascender: number
  descender: number
}

export interface LayoutOptions {
  /** Extra space between glyphs, in 1/1000 em (the usual tracking unit). */
  tracking?: number
  /** Multiple of the em. */
  lineHeight?: number
  /** Wrap width in font units; Infinity for no wrapping. */
  maxWidth?: number
  align?: 'left' | 'center' | 'right'
  /** Apply the font's kerning. */
  kerning?: boolean
  /** Apply GSUB substitutions such as standard ligatures. */
  ligatures?: boolean
}

interface ShapedChar {
  glyphIndex: number
  char: string
}

/**
 * Maps a string to glyph indices.
 *
 * opentype.js can run GSUB for us, which brings in standard ligatures; if
 * that fails for any reason we fall back to a plain cmap lookup so the
 * preview still renders.
 */
function shape(
  parsed: ParsedFont,
  text: string,
  ligatures: boolean,
): ShapedChar[] {
  if (ligatures) {
    try {
      const glyphs = parsed.otFont.stringToGlyphs(text)
      if (glyphs.length > 0) {
        return glyphs.map((glyph) => ({
          glyphIndex: glyph.index,
          char: glyph.unicode !== undefined ? String.fromCodePoint(glyph.unicode) : '',
        }))
      }
    } catch {
      // Fall through to the simple mapping.
    }
  }

  const result: ShapedChar[] = []
  for (const char of text) {
    const codepoint = char.codePointAt(0)
    if (codepoint === undefined) continue
    const glyphIndex = parsed.cmap.get(codepoint)
    result.push({ glyphIndex: glyphIndex ?? 0, char })
  }
  return result
}

function kerningBetween(
  parsed: ParsedFont,
  kerningEdits: Readonly<Record<string, number>>,
  left: number,
  right: number,
): number {
  const override = kerningEdits[`${left},${right}`]
  if (override !== undefined) return override
  try {
    return parsed.otFont.getKerningValue(left, right)
  } catch {
    return 0
  }
}

export function layoutText(
  parsed: ParsedFont,
  edits: GlyphEdits,
  kerningEdits: Readonly<Record<string, number>>,
  text: string,
  options: LayoutOptions = {},
): TextLayout {
  const upm = parsed.verticalMetrics.unitsPerEm
  const tracking = ((options.tracking ?? 0) / 1000) * upm
  const lineHeight = (options.lineHeight ?? 1.2) * upm
  const maxWidth = options.maxWidth ?? Infinity
  const useKerning = options.kerning ?? true

  const paragraphs = text.split('\n')
  const lines: TextLine[] = []

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push({ glyphs: [], width: 0, baseline: 0, text: '' })
      continue
    }

    // Wrap on spaces. Words longer than the measure are left to overflow
    // rather than broken mid-word.
    const words = paragraph.split(/(\s+)/).filter((part) => part.length > 0)
    let current = ''

    const flush = (): void => {
      if (current.length === 0) return
      lines.push(layoutLine(parsed, edits, kerningEdits, current, {
        tracking,
        useKerning,
        ligatures: options.ligatures ?? true,
      }))
      current = ''
    }

    for (const word of words) {
      const candidate = current + word
      const width = measure(parsed, edits, kerningEdits, candidate, {
        tracking,
        useKerning,
        ligatures: options.ligatures ?? true,
      })
      if (width > maxWidth && current.trim().length > 0) {
        flush()
        current = word.trimStart()
      } else {
        current = candidate
      }
    }
    flush()
  }

  let widest = 0
  lines.forEach((line, index) => {
    line.baseline = index * lineHeight
    widest = Math.max(widest, line.width)
  })

  const align = options.align ?? 'left'
  if (align !== 'left') {
    const measureWidth = Number.isFinite(maxWidth) ? maxWidth : widest
    for (const line of lines) {
      const slack = measureWidth - line.width
      const offset = align === 'center' ? slack / 2 : slack
      for (const glyph of line.glyphs) glyph.x += offset
    }
  }

  return {
    lines,
    unitsPerEm: upm,
    width: widest,
    height:
      lines.length === 0
        ? 0
        : (lines.length - 1) * lineHeight +
          parsed.verticalMetrics.ascender -
          parsed.verticalMetrics.descender,
    lineHeightUnits: lineHeight,
    ascender: parsed.verticalMetrics.ascender,
    descender: parsed.verticalMetrics.descender,
  }
}

interface LineOptions {
  tracking: number
  useKerning: boolean
  ligatures: boolean
}

function layoutLine(
  parsed: ParsedFont,
  edits: GlyphEdits,
  kerningEdits: Readonly<Record<string, number>>,
  text: string,
  options: LineOptions,
): TextLine {
  const shaped = shape(parsed, text, options.ligatures)
  const glyphs: PositionedGlyph[] = []
  let pen = 0
  let previous: number | null = null

  for (const item of shaped) {
    const kerning =
      options.useKerning && previous !== null
        ? kerningBetween(parsed, kerningEdits, previous, item.glyphIndex)
        : 0
    pen += kerning

    const advance = resolveAdvanceWidth(parsed, edits, item.glyphIndex)
    glyphs.push({
      glyphIndex: item.glyphIndex,
      x: pen,
      advance,
      kerning,
      char: item.char,
    })
    pen += advance + options.tracking
    previous = item.glyphIndex
  }

  // The trailing tracking is not part of the line's visible width.
  const width = Math.max(0, pen - (glyphs.length > 0 ? options.tracking : 0))
  return { glyphs, width, baseline: 0, text }
}

function measure(
  parsed: ParsedFont,
  edits: GlyphEdits,
  kerningEdits: Readonly<Record<string, number>>,
  text: string,
  options: LineOptions,
): number {
  return layoutLine(parsed, edits, kerningEdits, text, options).width
}

/** Convenience: the advance width of a string, in font units. */
export function measureText(
  parsed: ParsedFont,
  edits: GlyphEdits,
  kerningEdits: Readonly<Record<string, number>>,
  text: string,
  options: LayoutOptions = {},
): number {
  return measure(parsed, edits, kerningEdits, text, {
    tracking: ((options.tracking ?? 0) / 1000) * parsed.verticalMetrics.unitsPerEm,
    useKerning: options.kerning ?? true,
    ligatures: options.ligatures ?? true,
  })
}
