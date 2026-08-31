import type { EditTool } from '@/store/editorStore'

/** Pointer shape for each tool. */
export const TOOL_CURSORS: Record<EditTool, string> = {
  select: 'default',
  direct: 'default',
  pen: 'crosshair',
  anchor: 'pointer',
  knife: 'crosshair',
  rotate: 'crosshair',
  scale: 'crosshair',
  measure: 'crosshair',
  hand: 'grab',
  zoom: 'zoom-in',
}
