/**
 * Selection and canvas view state.
 *
 * Kept apart from the font document so that panning the canvas or changing
 * the selection never invalidates glyph memoisation, and apart from the UI
 * shell so that opening a panel does not disturb the editor.
 */
import { create } from 'zustand'
import { createId } from '@/utils/id'

export const EDIT_TOOL = {
  /** Whole-contour selection with a transform box. */
  Select: 'select',
  /** Anchor and handle editing. */
  Direct: 'direct',
  /** Draw new contours. */
  Pen: 'pen',
  /** Convert anchors between corner and smooth, pull handles out. */
  Anchor: 'anchor',
  /** Cut a contour open at a point on it. */
  Knife: 'knife',
  /** Rotate the selection about a placed origin. */
  Rotate: 'rotate',
  /** Scale the selection about a placed origin. */
  Scale: 'scale',
  /** Measure distances and angles. */
  Measure: 'measure',
  /** Pan. */
  Hand: 'hand',
  /** Marquee zoom. */
  Zoom: 'zoom',
} as const
export type EditTool = (typeof EDIT_TOOL)[keyof typeof EDIT_TOOL]

/** Single-key shortcuts, matching the conventions of vector editors. */
export const TOOL_SHORTCUTS: Record<string, EditTool> = {
  v: EDIT_TOOL.Select,
  a: EDIT_TOOL.Direct,
  p: EDIT_TOOL.Pen,
  c: EDIT_TOOL.Anchor,
  k: EDIT_TOOL.Knife,
  r: EDIT_TOOL.Rotate,
  s: EDIT_TOOL.Scale,
  i: EDIT_TOOL.Measure,
  h: EDIT_TOOL.Hand,
  z: EDIT_TOOL.Zoom,
}

export interface Guide {
  id: string
  axis: 'x' | 'y'
  value: number
}

export interface EditorState {
  /** Selected glyph indices, in click order. The last is the primary. */
  selectedGlyphs: number[]
  /** Node ids selected inside the primary glyph. */
  selectedNodes: string[]
  /** Contour ids selected with the selection tool. */
  selectedContours: string[]
  tool: EditTool
  /** Origin for the rotate and scale tools, in font units. */
  transformOrigin: { x: number; y: number } | null

  zoom: number
  panX: number
  panY: number
  /** Canvas viewport size, published by the canvas so zoom can centre on it. */
  viewportWidth: number
  viewportHeight: number
  /** Incremented to ask the canvas to re-fit the glyph. */
  fitToken: number

  showNodes: boolean
  showHandles: boolean
  showMetrics: boolean
  showGuides: boolean
  showCoordinates: boolean
  showContourDirection: boolean
  showFilled: boolean
  snapEnabled: boolean
  snapGrid: number
  guides: Guide[]

  selectGlyph: (index: number, mode?: 'replace' | 'toggle' | 'range') => void
  selectGlyphs: (indices: number[]) => void
  clearGlyphSelection: () => void
  setSelectedNodes: (ids: string[]) => void
  toggleNode: (id: string) => void
  clearNodeSelection: () => void
  setSelectedContours: (ids: string[]) => void
  setTool: (tool: EditTool) => void
  setTransformOrigin: (origin: { x: number; y: number } | null) => void

  setZoom: (zoom: number) => void
  zoomBy: (factor: number) => void
  setViewport: (width: number, height: number) => void
  setPan: (x: number, y: number) => void
  panBy: (dx: number, dy: number) => void
  requestFit: () => void
  toggle: (
    key:
      | 'showNodes'
      | 'showHandles'
      | 'showMetrics'
      | 'showGuides'
      | 'showCoordinates'
      | 'showContourDirection'
      | 'showFilled'
      | 'snapEnabled',
  ) => void
  setSnapGrid: (value: number) => void
  addGuide: (axis: 'x' | 'y', value: number) => void
  moveGuide: (id: string, value: number) => void
  removeGuide: (id: string) => void
  clearGuides: () => void
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 40

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedGlyphs: [],
  selectedNodes: [],
  selectedContours: [],
  tool: EDIT_TOOL.Direct,
  transformOrigin: null,

  zoom: 1,
  panX: 0,
  panY: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  fitToken: 0,

  showNodes: true,
  showHandles: true,
  showMetrics: true,
  showGuides: true,
  showCoordinates: false,
  showContourDirection: false,
  showFilled: true,
  snapEnabled: true,
  snapGrid: 1,
  guides: [],

  selectGlyph: (index, mode = 'replace') => {
    const current = get().selectedGlyphs
    if (mode === 'toggle') {
      const next = current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index]
      set({ selectedGlyphs: next, selectedNodes: [], selectedContours: [] })
      return
    }
    if (mode === 'range' && current.length > 0) {
      const anchor = current[current.length - 1]
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
      const range: number[] = []
      for (let i = from; i <= to; i += 1) range.push(i)
      set({ selectedGlyphs: range, selectedNodes: [], selectedContours: [] })
      return
    }
    set({
      selectedGlyphs: [index],
      selectedNodes: [],
      selectedContours: [],
      fitToken: get().fitToken + 1,
    })
  },

  selectGlyphs: (indices) =>
    set({ selectedGlyphs: indices, selectedNodes: [] }),

  clearGlyphSelection: () =>
    set({ selectedGlyphs: [], selectedNodes: [], selectedContours: [] }),

  setSelectedNodes: (ids) => set({ selectedNodes: ids }),
  setSelectedContours: (selectedContours) => set({ selectedContours }),
  setTransformOrigin: (transformOrigin) => set({ transformOrigin }),
  toggleNode: (id) => {
    const current = get().selectedNodes
    set({
      selectedNodes: current.includes(id)
        ? current.filter((n) => n !== id)
        : [...current, id],
    })
  },
  clearNodeSelection: () => set({ selectedNodes: [] }),
  setTool: (tool) =>
    set({
      tool,
      // Switching between anchor-level and contour-level work should not
      // leave a stale selection of the other kind highlighted.
      ...(tool === EDIT_TOOL.Select ? { selectedNodes: [] } : {}),
      ...(tool === EDIT_TOOL.Direct ? { selectedContours: [] } : {}),
    }),

  setZoom: (zoom) =>
    set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),

  /**
   * Zooms about the centre of the viewport, so what the user is looking at
   * stays put instead of drifting away from the font origin.
   */
  zoomBy: (factor) => {
    const { zoom, panX, panY, viewportWidth, viewportHeight } = get()
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor))
    if (viewportWidth === 0 || viewportHeight === 0) {
      set({ zoom: next })
      return
    }
    const anchorX = viewportWidth / 2
    const anchorY = viewportHeight / 2
    const scale = next / zoom
    set({
      zoom: next,
      panX: anchorX - (anchorX - panX) * scale,
      panY: anchorY - (anchorY - panY) * scale,
    })
  },

  setViewport: (viewportWidth, viewportHeight) =>
    set({ viewportWidth, viewportHeight }),
  setPan: (panX, panY) => set({ panX, panY }),
  panBy: (dx, dy) => set({ panX: get().panX + dx, panY: get().panY + dy }),
  requestFit: () => set({ fitToken: get().fitToken + 1 }),

  toggle: (key) => set({ [key]: !get()[key] } as Partial<EditorState>),
  setSnapGrid: (snapGrid) => set({ snapGrid: Math.max(0, snapGrid) }),

  addGuide: (axis, value) =>
    set({
      guides: [...get().guides, { id: createId('g'), axis, value: Math.round(value) }],
    }),
  moveGuide: (id, value) =>
    set({
      guides: get().guides.map((guide) =>
        guide.id === id ? { ...guide, value: Math.round(value) } : guide,
      ),
    }),
  removeGuide: (id) =>
    set({ guides: get().guides.filter((guide) => guide.id !== id) }),
  clearGuides: () => set({ guides: [] }),
}))

/** The glyph the inspector and canvas act on. */
export function primaryGlyphIndex(state: EditorState): number | null {
  return state.selectedGlyphs.length > 0
    ? state.selectedGlyphs[state.selectedGlyphs.length - 1]
    : null
}
