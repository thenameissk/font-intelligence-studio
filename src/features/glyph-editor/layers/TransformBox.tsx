import { memo } from 'react'
import type { Rect } from '@/types/geometry'
import type { ViewTransform } from '../canvasTransform'
import { toScreen } from '../canvasTransform'
import {
  HANDLE_CURSOR,
  handlePoint,
  TRANSFORM_HANDLES,
} from '../transformHandles'

/**
 * The selection's transform box.
 *
 * Eight handles scale, the zones just outside the corners rotate, and the
 * dashed frame shows what a transformation will act on. Everything is drawn
 * in screen space so the handles stay a constant size at any zoom.
 */
export const TransformBox = memo(function TransformBox({
  bounds,
  view,
  rotating,
}: {
  bounds: Rect
  view: ViewTransform
  rotating: boolean
}) {
  const topLeft = toScreen(view, { x: bounds.xMin, y: bounds.yMax })
  const bottomRight = toScreen(view, { x: bounds.xMax, y: bounds.yMin })
  const width = bottomRight.x - topLeft.x
  const height = bottomRight.y - topLeft.y

  // A box with no area still needs grabbable handles.
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null

  return (
    <g className="pointer-events-none">
      <rect
        x={topLeft.x}
        y={topLeft.y}
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        className="fill-none stroke-accent"
        strokeWidth={1}
        strokeDasharray="4 3"
      />

      {TRANSFORM_HANDLES.map((handle) => {
        const point = toScreen(view, handlePoint(handle, bounds))
        return (
          <g key={handle}>
            {/* Rotation zone: a larger, invisible target outside the handle. */}
            <circle
              cx={point.x}
              cy={point.y}
              r={11}
              data-rotate={handle}
              className="pointer-events-auto fill-transparent"
              style={{ cursor: 'grab' }}
            />
            <rect
              x={point.x - 3.5}
              y={point.y - 3.5}
              width={7}
              height={7}
              data-handle-transform={handle}
              className="pointer-events-auto fill-panel stroke-accent"
              strokeWidth={1.5}
              style={{ cursor: HANDLE_CURSOR[handle] }}
            />
          </g>
        )
      })}

      {rotating && (
        <text
          x={topLeft.x}
          y={topLeft.y - 6}
          className="fill-accent font-mono"
          fontSize={9}
        >
          rotating
        </text>
      )}
    </g>
  )
})
