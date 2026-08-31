import { memo, useMemo } from 'react'
import type { GlyphEdits } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveOutline } from '@/engine/parser/glyphAccess'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import { layoutText, type LayoutOptions } from '@/engine/typography/layout'

/**
 * Renders a block of text from the font's own outlines.
 *
 * Every glyph is a real path from the (possibly edited) font rather than a
 * webfont, which is the only way an edit can show up in running text without
 * round-tripping through a font file first.
 */
export const TextRender = memo(function TextRender({
  parsed,
  edits,
  kerningEdits,
  text,
  fontSize,
  options,
  color = 'currentColor',
  width,
}: {
  parsed: ParsedFont
  edits: GlyphEdits
  kerningEdits: Readonly<Record<string, number>>
  text: string
  fontSize: number
  options: LayoutOptions
  color?: string
  /** Available width in pixels; used as the measure. */
  width: number
}) {
  const upm = parsed.verticalMetrics.unitsPerEm
  const scale = fontSize / upm

  const layout = useMemo(
    () =>
      layoutText(parsed, edits, kerningEdits, text, {
        ...options,
        maxWidth: width > 0 ? width / scale : Infinity,
      }),
    [parsed, edits, kerningEdits, text, options, width, scale],
  )

  // Path data is cached per glyph: a paragraph repeats the same few dozen
  // glyphs many times over.
  const paths = useMemo(() => {
    const cache = new Map<number, string>()
    for (const line of layout.lines) {
      for (const glyph of line.glyphs) {
        if (cache.has(glyph.glyphIndex)) continue
        cache.set(
          glyph.glyphIndex,
          outlineToSvgPathData(
            resolveOutline(parsed, edits, glyph.glyphIndex),
            1,
          ),
        )
      }
    }
    return cache
  }, [layout, parsed, edits])

  const heightUnits =
    layout.lines.length === 0
      ? upm
      : (layout.lines.length - 1) * layout.lineHeightUnits +
        parsed.verticalMetrics.ascender -
        parsed.verticalMetrics.descender

  const pixelHeight = Math.max(1, heightUnits * scale)
  const pixelWidth = Math.max(1, width > 0 ? width : layout.width * scale)

  return (
    <svg
      width={pixelWidth}
      height={pixelHeight}
      viewBox={`0 ${-parsed.verticalMetrics.ascender} ${pixelWidth / scale} ${heightUnits}`}
      style={{ display: 'block', color }}
      aria-label={text}
    >
      {layout.lines.map((line, lineIndex) => (
        <g key={lineIndex} transform={`translate(0 ${line.baseline})`}>
          {line.glyphs.map((glyph, index) => {
            const data = paths.get(glyph.glyphIndex)
            if (!data) return null
            return (
              <path
                key={index}
                d={data}
                transform={`translate(${glyph.x} 0) scale(1 -1)`}
                fill="currentColor"
                fillRule="nonzero"
              />
            )
          })}
        </g>
      ))}
    </svg>
  )
})
