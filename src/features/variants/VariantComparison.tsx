import { useMemo } from 'react'
import type { Outline } from '@/types/geometry'
import type { VerticalMetrics } from '@/types/font'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import { diffHotspots } from '@/engine/analysis/outlineDiff'
import type { GlyphStructure } from '@/engine/analysis/glyphStructure'
import type { VariantChange } from '@/engine/analysis/variants'
import { outlineBounds } from '@/engine/geometry/outline'
import { buildAnnotations, placeLabels } from './annotations'

interface Side {
  outline: Outline
  advanceWidth: number
  caption: string
}

/**
 * Two forms of a letter, side by side on shared rules, with the places they
 * differ ringed and named.
 *
 * The point is to answer "what actually changes" on the letter itself rather
 * than in a list underneath it.
 */
export function VariantComparison({
  before,
  after,
  metrics,
  structure,
  changes,
  showAnnotations = true,
  className,
}: {
  before: Side
  after: Side
  metrics: VerticalMetrics
  structure?: GlyphStructure | null
  changes?: VariantChange[]
  showAnnotations?: boolean
  className?: string
}) {
  const upm = metrics.unitsPerEm
  const xHeight = metrics.xHeight ?? upm * 0.52
  const gap = upm * 0.12

  // Annotations describe the letterform on the left: what makes it the form
  // it is, and where it parts company with the alternative.
  const annotations = useMemo(() => {
    if (!showAnnotations || !structure) return []
    const hotspots = diffHotspots(before.outline, after.outline, {
      structure,
      limit: 3,
    })
    return buildAnnotations({
      structure,
      bounds: outlineBounds(before.outline),
      unitsPerEm: metrics.unitsPerEm,
      hotspots,
      changes,
      // Two is what a diagram can carry before it stops teaching anything.
      limit: 2,
    })
  }, [before.outline, after.outline, structure, changes, metrics.unitsPerEm, showAnnotations])

  const beforePath = useMemo(
    () => outlineToSvgPathData(before.outline, 1),
    [before.outline],
  )
  const afterPath = useMemo(
    () => outlineToSvgPathData(after.outline, 1),
    [after.outline],
  )

  const afterOffset = before.advanceWidth + gap
  const totalWidth = afterOffset + after.advanceWidth
  const padX = upm * 0.1
  const top = -(metrics.ascender * 0.92)
  const bottom = -(metrics.descender * 0.9) + upm * 0.28

  const labelSize = upm * 0.062
  const placed = useMemo(
    () =>
      placeLabels(annotations, {
        fontSize: labelSize,
        bounds: outlineBounds(before.outline),
      }),
    [annotations, labelSize, before.outline],
  )

  // Leave room above for any callout that had to climb clear of the letter.
  const highestLabel = placed.reduce(
    (min, label) => Math.min(min, label.labelY - labelSize),
    top,
  )

  const viewBox = [
    -padX,
    Math.min(top, highestLabel),
    totalWidth + padX * 2,
    bottom - Math.min(top, highestLabel),
  ].join(' ')

  // Rules are drawn in screen space, where y grows downwards.
  const rule = (value: number): number => -value

  return (
    <svg
      viewBox={viewBox}
      className={className}
      style={{ display: 'block', width: '100%', height: 'auto' }}
      role="img"
      aria-label={`${before.caption} compared with ${after.caption}`}
    >
      {/* Shared baseline and x-height, so the two forms can be judged
          against the same measure. */}
      {[0, xHeight].map((value) => (
        <line
          key={value}
          x1={-padX}
          y1={rule(value)}
          x2={totalWidth + padX}
          y2={rule(value)}
          className="stroke-line-strong"
          strokeWidth={upm * 0.004}
        />
      ))}

      <g transform="scale(1,-1)">
        <path d={beforePath} className="fill-glyph" fillRule="nonzero" />
        <path
          d={afterPath}
          className="fill-glyph"
          fillRule="nonzero"
          transform={`translate(${afterOffset} 0)`}
        />
      </g>

      {placed.map((label) => (
        <g key={label.id}>
          {/* Rings and labels both cross ink and paper, so each is drawn
              with a halo of the page colour behind it. Without that a
              callout lands on the letter and disappears. */}
          <circle
            cx={label.x}
            cy={rule(label.y)}
            r={label.radius}
            className="fill-none stroke-panel"
            strokeWidth={upm * 0.011}
          />
          <circle
            cx={label.x}
            cy={rule(label.y)}
            r={label.radius}
            className="fill-none stroke-ink-muted"
            strokeWidth={upm * 0.004}
          />
          {label.leader && (
            <>
              <line
                x1={label.leader.x1}
                y1={label.leader.y1}
                x2={label.leader.x2}
                y2={label.leader.y2}
                className="stroke-panel"
                strokeWidth={upm * 0.009}
              />
              <line
                x1={label.leader.x1}
                y1={label.leader.y1}
                x2={label.leader.x2}
                y2={label.leader.y2}
                className="stroke-ink-faint"
                strokeWidth={upm * 0.003}
              />
            </>
          )}
          <text
            x={label.labelX}
            y={label.labelY}
            className="fill-ink stroke-panel font-semibold"
            fontSize={labelSize}
            strokeWidth={labelSize * 0.5}
            paintOrder="stroke"
            strokeLinejoin="round"
            textAnchor={label.anchor}
          >
            {label.label}
          </text>
        </g>
      ))}

      <text
        x={before.advanceWidth / 2}
        y={rule(metrics.descender * 0.9) + upm * 0.16}
        className="fill-ink-muted"
        fontSize={upm * 0.072}
        textAnchor="middle"
      >
        {before.caption}
      </text>
      <text
        x={afterOffset + after.advanceWidth / 2}
        y={rule(metrics.descender * 0.9) + upm * 0.16}
        className="fill-ink-muted"
        fontSize={upm * 0.072}
        textAnchor="middle"
      >
        {after.caption}
      </text>
    </svg>
  )
}
