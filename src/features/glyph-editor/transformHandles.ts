/**
 * Geometry of the selection transform box.
 *
 * Kept out of the component so the maths can be reasoned about (and reused)
 * without dragging React in.
 */
import type { Rect } from '@/types/geometry'

export const TRANSFORM_HANDLES = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
] as const
export type TransformHandle = (typeof TRANSFORM_HANDLES)[number]

/** Unit position of each handle within the box, x and y from 0 to 1. */
const HANDLE_POSITION: Record<TransformHandle, [number, number]> = {
  nw: [0, 1],
  n: [0.5, 1],
  ne: [1, 1],
  e: [1, 0.5],
  se: [1, 0],
  s: [0.5, 0],
  sw: [0, 0],
  w: [0, 0.5],
}

export const HANDLE_CURSOR: Record<TransformHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

/** The opposite corner, which stays fixed while a handle is dragged. */
export function anchorForHandle(
  handle: TransformHandle,
  bounds: Rect,
): { x: number; y: number } {
  const [ux, uy] = HANDLE_POSITION[handle]
  return {
    x: bounds.xMin + (1 - ux) * (bounds.xMax - bounds.xMin),
    y: bounds.yMin + (1 - uy) * (bounds.yMax - bounds.yMin),
  }
}

export function handlePoint(
  handle: TransformHandle,
  bounds: Rect,
): { x: number; y: number } {
  const [ux, uy] = HANDLE_POSITION[handle]
  return {
    x: bounds.xMin + ux * (bounds.xMax - bounds.xMin),
    y: bounds.yMin + uy * (bounds.yMax - bounds.yMin),
  }
}

/** Which axes a handle scales: edge handles move one axis only. */
export function handleAxes(handle: TransformHandle): { x: boolean; y: boolean } {
  return {
    x: handle !== 'n' && handle !== 's',
    y: handle !== 'e' && handle !== 'w',
  }
}
