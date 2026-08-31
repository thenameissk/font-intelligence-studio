import { memo } from 'react'
import type { ViewTransform } from '../canvasTransform'
import { screenX, screenY } from '../canvasTransform'
import { RULER_SIZE } from './RulersLayer'

export interface MetricLine {
  label: string
  value: number
  /** Primary lines get a stronger stroke. */
  strong?: boolean
}

/**
 * Horizontal metric lines plus the advance-width box and side bearings.
 * These are the reference frame a type designer works against.
 */
export const MetricsLayer = memo(function MetricsLayer({
  view,
  width,
  height,
  lines,
  advanceWidth,
  bounds,
  showBearings,
  isEmpty,
}: {
  view: ViewTransform
  width: number
  height: number
  lines: MetricLine[]
  advanceWidth: number
  bounds: { xMin: number; xMax: number }
  showBearings: boolean
  isEmpty: boolean
}) {
  const originX = screenX(view, 0)
  const advanceX = screenX(view, advanceWidth)

  return (
    <g className="pointer-events-none">
      {/* Advance width band */}
      <rect
        x={Math.min(originX, advanceX)}
        y={RULER_SIZE}
        width={Math.abs(advanceX - originX)}
        height={Math.max(0, height - RULER_SIZE)}
        className="fill-accent/[0.04]"
      />

      {lines.map((line) => {
        const y = Math.round(screenY(view, line.value)) + 0.5
        if (y < RULER_SIZE || y > height) return null
        return (
          <g key={line.label}>
            <line
              x1={RULER_SIZE}
              y1={y}
              x2={width}
              y2={y}
              className={line.strong ? 'stroke-guide-strong' : 'stroke-guide'}
              strokeWidth={1}
              strokeDasharray={line.strong ? undefined : '3 3'}
            />
            <text
              x={width - 6}
              y={y - 4}
              textAnchor="end"
              className="fill-ink-faint font-mono"
              fontSize={9}
            >
              {line.label} {Math.round(line.value)}
            </text>
          </g>
        )
      })}

      {/* Origin and advance verticals */}
      {[
        { x: originX, label: '0' },
        { x: advanceX, label: String(Math.round(advanceWidth)) },
      ].map((vertical, i) => (
        <line
          key={i}
          x1={Math.round(vertical.x) + 0.5}
          y1={RULER_SIZE}
          x2={Math.round(vertical.x) + 0.5}
          y2={height}
          className="stroke-guide-strong"
          strokeWidth={1}
        />
      ))}

      {showBearings && !isEmpty && (
        <>
          <BearingBand
            from={originX}
            to={screenX(view, bounds.xMin)}
            height={height}
            label={`LSB ${Math.round(bounds.xMin)}`}
          />
          <BearingBand
            from={screenX(view, bounds.xMax)}
            to={advanceX}
            height={height}
            label={`RSB ${Math.round(advanceWidth - bounds.xMax)}`}
          />
        </>
      )}
    </g>
  )
})

function BearingBand({
  from,
  to,
  height,
  label,
}: {
  from: number
  to: number
  height: number
  label: string
}) {
  const x = Math.min(from, to)
  const bandWidth = Math.abs(to - from)
  if (bandWidth < 0.5) return null
  return (
    <g>
      <rect
        x={x}
        y={RULER_SIZE}
        width={bandWidth}
        height={Math.max(0, height - RULER_SIZE)}
        className="fill-accent/[0.07]"
      />
      {bandWidth > 42 && (
        <text
          x={x + bandWidth / 2}
          y={height - 8}
          textAnchor="middle"
          className="fill-ink-faint font-mono"
          fontSize={9}
        >
          {label}
        </text>
      )}
    </g>
  )
}
