import { memo } from 'react'
import type { ViewTransform } from '../canvasTransform'
import { rulerStep, screenX, screenY } from '../canvasTransform'

export const RULER_SIZE = 18

/** Rulers along the top and left edges, labelled in font units. */
export const RulersLayer = memo(function RulersLayer({
  view,
  width,
  height,
  unitsPerEm,
  cursor,
}: {
  view: ViewTransform
  width: number
  height: number
  unitsPerEm: number
  cursor: { x: number; y: number } | null
}) {
  const step = rulerStep(view.zoom, unitsPerEm)
  const firstX = Math.ceil((0 - view.originX) / view.zoom / step) * step
  const lastX = Math.floor((width - view.originX) / view.zoom / step) * step
  const firstY = Math.ceil((view.originY - height) / view.zoom / step) * step
  const lastY = Math.floor(view.originY / view.zoom / step) * step

  const ticksX: number[] = []
  for (let value = firstX; value <= lastX; value += step) ticksX.push(value)
  const ticksY: number[] = []
  for (let value = firstY; value <= lastY; value += step) ticksY.push(value)

  return (
    <g className="pointer-events-none">
      <rect
        x={0}
        y={0}
        width={width}
        height={RULER_SIZE}
        className="fill-panel"
      />
      <rect
        x={0}
        y={0}
        width={RULER_SIZE}
        height={height}
        className="fill-panel"
      />
      <line
        x1={0}
        y1={RULER_SIZE + 0.5}
        x2={width}
        y2={RULER_SIZE + 0.5}
        className="stroke-line"
        strokeWidth={1}
      />
      <line
        x1={RULER_SIZE + 0.5}
        y1={0}
        x2={RULER_SIZE + 0.5}
        y2={height}
        className="stroke-line"
        strokeWidth={1}
      />

      {ticksX.map((value) => {
        const x = Math.round(screenX(view, value)) + 0.5
        if (x < RULER_SIZE) return null
        return (
          <g key={`x${value}`}>
            <line
              x1={x}
              y1={RULER_SIZE - 4}
              x2={x}
              y2={RULER_SIZE}
              className="stroke-ink-faint"
              strokeWidth={1}
            />
            <text
              x={x + 3}
              y={RULER_SIZE - 6}
              className="fill-ink-faint font-mono"
              fontSize={9}
            >
              {value}
            </text>
          </g>
        )
      })}

      {ticksY.map((value) => {
        const y = Math.round(screenY(view, value)) + 0.5
        if (y < RULER_SIZE) return null
        return (
          <g key={`y${value}`}>
            <line
              x1={RULER_SIZE - 4}
              y1={y}
              x2={RULER_SIZE}
              y2={y}
              className="stroke-ink-faint"
              strokeWidth={1}
            />
            <text
              x={2}
              y={y - 3}
              className="fill-ink-faint font-mono"
              fontSize={9}
            >
              {value}
            </text>
          </g>
        )
      })}

      {cursor && (
        <>
          <line
            x1={cursor.x + 0.5}
            y1={0}
            x2={cursor.x + 0.5}
            y2={RULER_SIZE}
            className="stroke-accent"
            strokeWidth={1}
          />
          <line
            x1={0}
            y1={cursor.y + 0.5}
            x2={RULER_SIZE}
            y2={cursor.y + 0.5}
            className="stroke-accent"
            strokeWidth={1}
          />
        </>
      )}

      <rect
        x={0}
        y={0}
        width={RULER_SIZE}
        height={RULER_SIZE}
        className="fill-panel"
      />
    </g>
  )
})
