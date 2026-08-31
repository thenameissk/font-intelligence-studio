import { memo, useMemo } from 'react'
import type { Outline } from '@/types/geometry'
import { outlineToSvgPathData } from '@/engine/geometry/outline'

/**
 * Renders a glyph outline as a real vector path.
 *
 * The em box is mapped into the viewport with a y-flip, so the outline is
 * drawn from the font's own coordinates rather than from a rasterised
 * preview.
 */
export const GlyphPreview = memo(function GlyphPreview({
  outline,
  unitsPerEm,
  ascender,
  descender,
  advanceWidth,
  size,
  padding = 0.08,
  className,
  fitToInk = false,
}: {
  outline: Outline
  unitsPerEm: number
  ascender: number
  descender: number
  advanceWidth: number
  size: number
  padding?: number
  className?: string
  fitToInk?: boolean
}) {
  const pathData = useMemo(() => outlineToSvgPathData(outline), [outline])

  // Vertical span shown: the font's ascender-to-descender box, which keeps
  // every glyph on a shared baseline instead of scaling each one on its own.
  const top = Math.max(ascender, unitsPerEm * 0.8)
  const bottom = Math.min(descender, -unitsPerEm * 0.2)
  const spanY = top - bottom
  const spanX = Math.max(advanceWidth, unitsPerEm * 0.25)
  const span = fitToInk ? spanX : Math.max(spanX, spanY)
  const pad = span * padding

  const viewBox = fitToInk
    ? `${-pad} ${-top - pad} ${spanX + pad * 2} ${spanY + pad * 2}`
    : `${(spanX - span) / 2 - pad} ${-top - pad} ${span + pad * 2} ${span + pad * 2}`

  if (pathData.length === 0) return null

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      className={className}
      aria-hidden
    >
      {/* Font space is y-up; SVG is y-down. */}
      <g transform="scale(1,-1)">
        <path d={pathData} fill="currentColor" fillRule="nonzero" />
      </g>
    </svg>
  )
})
