import { memo, useMemo } from 'react'
import type { Outline } from '@/types/geometry'
import {
  contourDirection,
  contourSegments,
  outlineToSvgPathData,
} from '@/engine/geometry/outline'
import { cubicAt, cubicDerivativeAt } from '@/engine/geometry/bezier'
import type { ViewTransform } from '../canvasTransform'
import { toScreen } from '../canvasTransform'

/**
 * The glyph outline itself, drawn from real path data.
 *
 * The path stays in font coordinates inside a transformed group, so panning
 * and zooming never re-serialise it; only the small direction markers are
 * computed in screen space.
 */
export const OutlineLayer = memo(function OutlineLayer({
  outline,
  view,
  filled,
  showDirection,
  highlightedContours,
}: {
  outline: Outline
  view: ViewTransform
  filled: boolean
  showDirection: boolean
  /** Contour ids to draw emphasised, for the selection tool. */
  highlightedContours?: ReadonlySet<string>
}) {
  const pathData = useMemo(() => outlineToSvgPathData(outline, 3), [outline])

  // The fill has to be one path so the non-zero rule punches counters out,
  // but strokes are drawn per contour so a selected one can be emphasised.
  const contourPaths = useMemo(
    () =>
      outline.contours.map((contour) => ({
        id: contour.id,
        d: outlineToSvgPathData({ contours: [contour] }, 3),
      })),
    [outline],
  )

  const markers = useMemo(() => {
    if (!showDirection) return []
    return outline.contours.flatMap((contour) => {
      const segments = contourSegments(contour)
      if (segments.length === 0) return []
      const segment = segments[Math.floor(segments.length / 2)]
      const point =
        segment.kind === 'cubic'
          ? cubicAt(segment.from, segment.c1, segment.c2, segment.to, 0.5)
          : {
              x: (segment.from.x + segment.to.x) / 2,
              y: (segment.from.y + segment.to.y) / 2,
            }
      const tangent =
        segment.kind === 'cubic'
          ? cubicDerivativeAt(segment.from, segment.c1, segment.c2, segment.to, 0.5)
          : { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y }
      return [
        {
          id: contour.id,
          screen: toScreen(view, point),
          // Screen y is flipped, so the tangent's y flips with it.
          angle: (Math.atan2(-tangent.y, tangent.x) * 180) / Math.PI,
          direction: contourDirection(contour),
          start: toScreen(view, contour.nodes[0]),
        },
      ]
    })
  }, [outline, view, showDirection])

  if (pathData.length === 0) {
    return null
  }

  return (
    <g>
      <g
        transform={`translate(${view.originX} ${view.originY}) scale(${view.zoom} ${-view.zoom})`}
      >
        <path
          d={pathData}
          fillRule="nonzero"
          className={filled ? 'fill-glyph' : 'fill-none'}
          fillOpacity={filled ? 0.9 : 0}
        />
        {contourPaths.map((contour) => {
          const highlighted = highlightedContours?.has(contour.id) ?? false
          return (
            <path
              key={contour.id}
              d={contour.d}
              fill="none"
              className={highlighted ? 'stroke-accent' : 'stroke-accent'}
              strokeWidth={highlighted ? 2.5 : 1}
              vectorEffect="non-scaling-stroke"
              opacity={highlighted ? 1 : filled ? 0.55 : 1}
            />
          )
        })}
      </g>

      {markers.map((marker) => (
        <g key={marker.id} className="pointer-events-none">
          <path
            d="M -4 -3.5 L 4 0 L -4 3.5 Z"
            transform={`translate(${marker.screen.x} ${marker.screen.y}) rotate(${marker.angle})`}
            className={
              marker.direction === 'ccw' ? 'fill-ok' : 'fill-warn'
            }
          />
          <circle
            cx={marker.start.x}
            cy={marker.start.y}
            r={3.5}
            className="fill-none stroke-ok"
            strokeWidth={1.5}
          />
        </g>
      ))}
    </g>
  )
})
