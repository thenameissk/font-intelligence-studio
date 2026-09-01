import { memo, useMemo } from 'react'
import type { ViewTransform } from '../canvasTransform'
import { toFont, toScreen } from '../canvasTransform'
import { RULER_SIZE } from './RulersLayer'

/**
 * A unit grid behind the glyph.
 *
 * Drawn adaptively: at low zoom a grid at its true spacing would be a solid
 * wash of lines that hides the letter, so the step is multiplied up until
 * the lines are far enough apart to read. Every tenth line is emphasised,
 * which is what makes it possible to count units by eye rather than
 * squinting at the rulers.
 */
export const GridLayer = memo(function GridLayer({
  view,
  width,
  height,
  spacing,
  unitsPerEm,
}: {
  view: ViewTransform
  width: number
  height: number
  /** Grid step in font units. */
  spacing: number
  unitsPerEm: number
}) {
  const lines = useMemo(() => {
    if (spacing <= 0 || width <= 0 || height <= 0) {
      return { minor: [] as string[], major: [] as string[] }
    }

    // Coarsen until the lines are at least a few pixels apart.
    const MIN_PIXELS = 7
    let step = spacing
    let guard = 0
    while (step * view.zoom < MIN_PIXELS && guard++ < 12) step *= 2

    // Below this there is nothing worth drawing at all.
    if (step * view.zoom < 3) return { minor: [], major: [] }

    const topLeft = toFont(view, { x: 0, y: RULER_SIZE })
    const bottomRight = toFont(view, { x: width, y: height })

    const majorEvery = step * 10
    const minor: string[] = []
    const major: string[] = []

    const firstX = Math.floor(topLeft.x / step) * step
    for (let x = firstX; x <= bottomRight.x; x += step) {
      const screenX = toScreen(view, { x, y: 0 }).x
      if (screenX < RULER_SIZE || screenX > width) continue
      const line = `M${screenX} ${RULER_SIZE}V${height}`
      // Floating point drift makes an exact modulo unreliable over a long
      // run, so compare against the nearest multiple instead.
      const onMajor = Math.abs(x - Math.round(x / majorEvery) * majorEvery) < step / 4
      ;(onMajor ? major : minor).push(line)
    }

    const firstY = Math.floor(bottomRight.y / step) * step
    for (let y = firstY; y <= topLeft.y; y += step) {
      const screenY = toScreen(view, { x: 0, y }).y
      if (screenY < RULER_SIZE || screenY > height) continue
      const line = `M${RULER_SIZE} ${screenY}H${width}`
      const onMajor = Math.abs(y - Math.round(y / majorEvery) * majorEvery) < step / 4
      ;(onMajor ? major : minor).push(line)
    }

    return { minor, major }
  }, [view, width, height, spacing])

  if (lines.minor.length === 0 && lines.major.length === 0) return null

  // The em square, which is the one grid line that means something.
  const emLeft = toScreen(view, { x: 0, y: 0 }).x
  const emRight = toScreen(view, { x: unitsPerEm, y: 0 }).x

  return (
    <g className="pointer-events-none">
      <path d={lines.minor.join('')} className="stroke-line" strokeWidth={0.5} opacity={0.5} />
      <path d={lines.major.join('')} className="stroke-line-strong" strokeWidth={0.5} opacity={0.7} />
      {emRight - emLeft > 24 && (
        <rect
          x={emLeft}
          y={toScreen(view, { x: 0, y: unitsPerEm }).y}
          width={emRight - emLeft}
          height={emRight - emLeft}
          className="fill-none stroke-line-strong"
          strokeWidth={1}
          strokeDasharray="2 4"
          opacity={0.6}
        />
      )}
    </g>
  )
})
