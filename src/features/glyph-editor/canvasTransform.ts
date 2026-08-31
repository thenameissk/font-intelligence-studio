/**
 * Mapping between font units and canvas pixels.
 *
 * Font space is y-up with the baseline at y = 0; the canvas is y-down. The
 * transform is a uniform scale plus a translation, so a glyph never shears
 * or distorts on screen.
 */
import type { Point, Rect } from '@/types/geometry'

export interface ViewTransform {
  zoom: number
  /** Screen position of the font-space origin (0, 0). */
  originX: number
  originY: number
}

export function toScreen(view: ViewTransform, point: Point): Point {
  return {
    x: view.originX + point.x * view.zoom,
    y: view.originY - point.y * view.zoom,
  }
}

export function toFont(view: ViewTransform, point: Point): Point {
  return {
    x: (point.x - view.originX) / view.zoom,
    y: (view.originY - point.y) / view.zoom,
  }
}

export function screenX(view: ViewTransform, x: number): number {
  return view.originX + x * view.zoom
}

export function screenY(view: ViewTransform, y: number): number {
  return view.originY - y * view.zoom
}

export function fontDistance(view: ViewTransform, pixels: number): number {
  return pixels / view.zoom
}

export interface FitInput {
  width: number
  height: number
  /** Ink bounds of the glyph; may be empty. */
  bounds: Rect
  advanceWidth: number
  ascender: number
  descender: number
  unitsPerEm: number
  padding?: number
}

/**
 * Frames the glyph so its advance box and the font's vertical extents are
 * both visible, with a little breathing room.
 */
export function fitView(input: FitInput): ViewTransform {
  const padding = input.padding ?? 56
  const top = Math.max(input.ascender, input.bounds.yMax, input.unitsPerEm * 0.75)
  const bottom = Math.min(input.descender, input.bounds.yMin, -input.unitsPerEm * 0.2)
  const left = Math.min(0, input.bounds.xMin)
  const right = Math.max(input.advanceWidth, input.bounds.xMax, input.unitsPerEm * 0.3)

  const spanX = Math.max(1, right - left)
  const spanY = Math.max(1, top - bottom)
  const usableWidth = Math.max(1, input.width - padding * 2)
  const usableHeight = Math.max(1, input.height - padding * 2)

  const zoom = Math.min(usableWidth / spanX, usableHeight / spanY)

  return {
    zoom,
    originX: input.width / 2 - ((left + right) / 2) * zoom,
    originY: input.height / 2 + ((top + bottom) / 2) * zoom,
  }
}

/** Zooms around a fixed screen point, so the point under the cursor stays put. */
export function zoomAround(
  view: ViewTransform,
  anchor: Point,
  factor: number,
  limits: { min: number; max: number },
): ViewTransform {
  const zoom = Math.min(limits.max, Math.max(limits.min, view.zoom * factor))
  const scale = zoom / view.zoom
  return {
    zoom,
    originX: anchor.x - (anchor.x - view.originX) * scale,
    originY: anchor.y - (anchor.y - view.originY) * scale,
  }
}

/** Chooses a ruler step that stays legible at the current zoom. */
export function rulerStep(zoom: number, unitsPerEm: number): number {
  const targetPixels = 64
  const rawStep = targetPixels / zoom
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)))
  for (const multiple of [1, 2, 5, 10]) {
    if (magnitude * multiple >= rawStep) return magnitude * multiple
  }
  return Math.max(magnitude * 10, unitsPerEm / 16)
}
