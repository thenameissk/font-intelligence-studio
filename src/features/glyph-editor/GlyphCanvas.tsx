import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Contour, Outline, OutlineNode, Point, Rect } from '@/types/geometry'
import type { ResolvedGlyph } from '@/types/font'
import type { FontDna } from '@/types/analysis'
import type { ParsedFont } from '@/engine/parser/parseFont'
import {
  breakContourAt,
  deleteNodes,
  findNode,
  hitTestOutline,
  insertNode,
  moveHandle,
  moveNodes,
  setNodeSmooth,
} from '@/engine/geometry/edit'
import {
  appendContours,
  contoursBounds,
  contoursInRect,
  deleteContours,
  duplicateContours,
  hitTestContours,
  moveContours,
  nodesBounds,
  transformContours,
  transformNodes,
} from '@/engine/geometry/pathOps'
import { about, rotation, scaling } from '@/engine/geometry/transform'
import { createNode } from '@/engine/geometry/outline'
import { createId } from '@/utils/id'
import {
  EDIT_TOOL,
  MAX_ZOOM,
  MIN_ZOOM,
  useEditorStore,
  type EditTool,
} from '@/store/editorStore'
import { useHistoryStore } from '@/store/historyStore'
import {
  fitView,
  toFont,
  toScreen,
  zoomAround,
  type ViewTransform,
} from './canvasTransform'
import { snapPoint, type SnapTarget } from './snapping'
import { buildMetricLines } from './metricLines'
import { GridLayer } from './layers/GridLayer'
import { MetricsLayer } from './layers/MetricsLayer'
import { OutlineLayer } from './layers/OutlineLayer'
import { NodesLayer } from './layers/NodesLayer'
import { RulersLayer, RULER_SIZE } from './layers/RulersLayer'
import { TransformBox } from './layers/TransformBox'
import {
  anchorForHandle,
  handleAxes,
  type TransformHandle,
} from './transformHandles'
import { TOOL_CURSORS } from './toolCursors'
import { clipboard } from './clipboard'

const SNAP_PIXELS = 6
const HIT_PIXELS = 8
const CLOSE_PIXELS = 10

/** What a transformation should act on. */
type Target =
  | { kind: 'nodes'; ids: string[] }
  | { kind: 'contours'; ids: string[] }

type Drag =
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'guide'; axis: 'x' | 'y'; id: string | null }
  | { kind: 'nodes'; nodeIds: string[]; start: Point; baseOutline: Outline }
  | { kind: 'handle'; nodeId: string; handle: 'in' | 'out'; baseOutline: Outline }
  | {
      kind: 'marquee'
      start: Point
      current: Point
      mode: 'nodes' | 'contours' | 'zoom'
    }
  | { kind: 'contours'; contourIds: string[]; start: Point; baseOutline: Outline }
  | {
      kind: 'scaleBox'
      handle: TransformHandle
      bounds: Rect
      baseOutline: Outline
      target: Target
    }
  | {
      kind: 'rotate'
      origin: Point
      startAngle: number
      baseOutline: Outline
      target: Target
    }
  | {
      kind: 'scaleTool'
      origin: Point
      startDistance: number
      baseOutline: Outline
      target: Target
    }
  | { kind: 'pen'; nodeIndex: number }
  | { kind: 'measure'; start: Point; current: Point }

interface PenState {
  nodes: OutlineNode[]
}

/**
 * The pen keeps its in-progress path in a ref rather than only in state.
 * Clicks can arrive faster than React re-renders, and reading the path from
 * a stale render closure would silently drop points.
 */
function usePenState(): [
  PenState | null,
  React.RefObject<PenState | null>,
  (next: PenState | null) => void,
] {
  const ref = useRef<PenState | null>(null)
  const [value, setValue] = useState<PenState | null>(null)
  const set = useCallback((next: PenState | null) => {
    ref.current = next
    setValue(next)
  }, [])
  return [value, ref, set]
}

export function GlyphCanvas({
  parsed,
  glyph,
  dna,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  dna: FontDna | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [cursor, setCursor] = useState<Point | null>(null)
  const [cursorScreen, setCursorScreen] = useState<Point | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [activeSnaps, setActiveSnaps] = useState<{
    x: SnapTarget | null
    y: SnapTarget | null
  }>({ x: null, y: null })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [marquee, setMarquee] = useState<Drag & { kind: 'marquee' } | null>(null)
  const [measure, setMeasure] = useState<{ start: Point; current: Point } | null>(
    null,
  )
  const [pen, penRef, setPen] = usePenState()
  const [rotating, setRotating] = useState(false)
  const dragRef = useRef<Drag | null>(null)

  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const zoom = useEditorStore((s) => s.zoom)
  const panX = useEditorStore((s) => s.panX)
  const panY = useEditorStore((s) => s.panY)
  const fitToken = useEditorStore((s) => s.fitToken)
  const setZoom = useEditorStore((s) => s.setZoom)
  const setPan = useEditorStore((s) => s.setPan)
  const setViewport = useEditorStore((s) => s.setViewport)
  const selectedNodes = useEditorStore((s) => s.selectedNodes)
  const setSelectedNodes = useEditorStore((s) => s.setSelectedNodes)
  const selectedContours = useEditorStore((s) => s.selectedContours)
  const setSelectedContours = useEditorStore((s) => s.setSelectedContours)
  const transformOrigin = useEditorStore((s) => s.transformOrigin)
  const setTransformOrigin = useEditorStore((s) => s.setTransformOrigin)
  const showNodes = useEditorStore((s) => s.showNodes)
  const showHandles = useEditorStore((s) => s.showHandles)
  const showMetrics = useEditorStore((s) => s.showMetrics)
  const showGuides = useEditorStore((s) => s.showGuides)
  const showFilled = useEditorStore((s) => s.showFilled)
  const showDirection = useEditorStore((s) => s.showContourDirection)
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const snapGrid = useEditorStore((s) => s.snapGrid)
  const showGrid = useEditorStore((s) => s.showGrid)
  const guides = useEditorStore((s) => s.guides)
  const addGuide = useEditorStore((s) => s.addGuide)
  const moveGuide = useEditorStore((s) => s.moveGuide)
  const removeGuide = useEditorStore((s) => s.removeGuide)

  const view: ViewTransform = useMemo(
    () => ({ zoom, originX: panX, originY: panY }),
    [zoom, panX, panY],
  )

  const metricLines = useMemo(
    () => buildMetricLines(parsed.verticalMetrics, dna),
    [parsed.verticalMetrics, dna],
  )

  // ---- Sizing and fit ---------------------------------------------------
  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      setViewport(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    setViewport(element.clientWidth, element.clientHeight)
    return () => observer.disconnect()
  }, [setViewport])

  const fit = useCallback(() => {
    if (size.width === 0 || size.height === 0) return
    const fitted = fitView({
      width: size.width,
      height: size.height,
      bounds: glyph.bounds,
      advanceWidth: glyph.advanceWidth,
      ascender: parsed.verticalMetrics.ascender,
      descender: parsed.verticalMetrics.descender,
      unitsPerEm: parsed.verticalMetrics.unitsPerEm,
    })
    setZoom(fitted.zoom)
    setPan(fitted.originX, fitted.originY)
  }, [size, glyph, parsed.verticalMetrics, setZoom, setPan])

  useEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken, size.width, size.height, glyph.index])

  // Changing glyph abandons any half-drawn path.
  useEffect(() => setPen(null), [glyph.index, setPen])

  // ---- Snapping ---------------------------------------------------------
  const snapContext = useMemo(() => {
    const x: SnapTarget[] = [
      { value: 0, label: 'origin', kind: 'origin' },
      { value: glyph.advanceWidth, label: 'advance', kind: 'origin' },
    ]
    const y: SnapTarget[] = metricLines.map((line) => ({
      value: line.value,
      label: line.label,
      kind: line.value === 0 ? 'origin' : 'metric',
    }))
    for (const guide of guides) {
      ;(guide.axis === 'x' ? x : y).push({
        value: guide.value,
        label: 'guide',
        kind: 'guide',
      })
    }
    const selected = new Set(selectedNodes)
    for (const contour of glyph.outline.contours) {
      for (const node of contour.nodes) {
        if (selected.has(node.id)) continue
        x.push({ value: node.x, label: 'node', kind: 'node' })
        y.push({ value: node.y, label: 'node', kind: 'node' })
      }
    }
    return { x, y }
  }, [glyph, metricLines, guides, selectedNodes])

  const applySnap = useCallback(
    (point: Point, enabled: boolean) => {
      if (!enabled || !snapEnabled) {
        setActiveSnaps({ x: null, y: null })
        return point
      }
      const result = snapPoint(point, {
        x: snapContext.x,
        y: snapContext.y,
        tolerance: SNAP_PIXELS / view.zoom,
        grid: snapGrid,
      })
      setActiveSnaps({ x: result.x, y: result.y })
      return result.point
    },
    [snapContext, snapEnabled, snapGrid, view.zoom],
  )

  // ---- Committing edits -------------------------------------------------
  const history = useHistoryStore

  const editFor = useCallback(
    (outline: Outline) => ({
      [glyph.index]: {
        outline,
        ...(glyph.modified ? { advanceWidth: glyph.advanceWidth } : {}),
      },
    }),
    [glyph.index, glyph.modified, glyph.advanceWidth],
  )

  const applyOutline = useCallback(
    (outline: Outline) => history.getState().update(editFor(outline)),
    [editFor, history],
  )
  const commitOutline = useCallback(
    (label: string, outline: Outline) =>
      history.getState().commit(label, editFor(outline)),
    [editFor, history],
  )

  // ---- Selection helpers ------------------------------------------------
  const currentTarget = useCallback((): Target | null => {
    if (selectedNodes.length > 0) return { kind: 'nodes', ids: selectedNodes }
    if (selectedContours.length > 0) {
      return { kind: 'contours', ids: selectedContours }
    }
    return null
  }, [selectedNodes, selectedContours])

  const targetBounds = useMemo((): Rect | null => {
    if (selectedNodes.length > 1) {
      return nodesBounds(glyph.outline, selectedNodes)
    }
    if (selectedContours.length > 0) {
      return contoursBounds(glyph.outline, selectedContours)
    }
    return null
  }, [glyph.outline, selectedNodes, selectedContours])

  const applyToTarget = useCallback(
    (base: Outline, target: Target, matrix: Parameters<typeof transformNodes>[2]) =>
      target.kind === 'nodes'
        ? transformNodes(base, target.ids, matrix)
        : transformContours(base, target.ids, matrix),
    [],
  )

  // ---- Pen --------------------------------------------------------------
  const commitPen = useCallback(
    (closed: boolean) => {
      const current = penRef.current
      setPen(null)
      if (!current || current.nodes.length < 2) return
      const contour: Contour = {
        id: createId('c'),
        nodes: current.nodes,
        closed,
      }
      commitOutline(
        closed ? 'Draw closed contour' : 'Draw contour',
        appendContours(glyph.outline, [contour]),
      )
    },
    [commitOutline, glyph.outline, penRef, setPen],
  )

  // ---- Pointer ----------------------------------------------------------
  const localPoint = (event: React.PointerEvent | PointerEvent): Point => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const screen = localPoint(event)
    const font = toFont(view, screen)
    event.currentTarget.setPointerCapture(event.pointerId)

    // Rulers create guides regardless of the active tool.
    if (screen.x < RULER_SIZE || screen.y < RULER_SIZE) {
      const axis = screen.x < RULER_SIZE ? 'y' : 'x'
      addGuide(axis, axis === 'x' ? font.x : font.y)
      const created = useEditorStore.getState().guides.at(-1)
      dragRef.current = { kind: 'guide', axis, id: created?.id ?? null }
      return
    }

    // Space, the middle button and the hand tool all pan.
    if (event.button === 1 || spaceHeld || tool === EDIT_TOOL.Hand) {
      dragRef.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originX: view.originX,
        originY: view.originY,
      }
      return
    }

    const element = event.target as SVGElement
    const nodeId = element.getAttribute('data-node')
    const handleKind = element.getAttribute('data-handle') as 'in' | 'out' | null
    const boxHandle = element.getAttribute(
      'data-handle-transform',
    ) as TransformHandle | null
    const rotateHandle = element.getAttribute('data-rotate') as TransformHandle | null

    // The transform box works under any selection tool.
    const target = currentTarget()
    if (boxHandle && targetBounds && target) {
      history.getState().begin('Scale selection')
      dragRef.current = {
        kind: 'scaleBox',
        handle: boxHandle,
        bounds: targetBounds,
        baseOutline: glyph.outline,
        target,
      }
      return
    }
    if (rotateHandle && targetBounds && target) {
      const centre = {
        x: (targetBounds.xMin + targetBounds.xMax) / 2,
        y: (targetBounds.yMin + targetBounds.yMax) / 2,
      }
      history.getState().begin('Rotate selection')
      setRotating(true)
      dragRef.current = {
        kind: 'rotate',
        origin: centre,
        startAngle: Math.atan2(font.y - centre.y, font.x - centre.x),
        baseOutline: glyph.outline,
        target,
      }
      return
    }

    switch (tool) {
      case EDIT_TOOL.Pen:
        return onPenDown(event, font)
      case EDIT_TOOL.Anchor:
        return onAnchorDown(event, font, nodeId)
      case EDIT_TOOL.Knife:
        return onKnifeDown(font)
      case EDIT_TOOL.Zoom:
        return onZoomDown(event, screen, font)
      case EDIT_TOOL.Measure:
        dragRef.current = { kind: 'measure', start: font, current: font }
        setMeasure({ start: font, current: font })
        return
      case EDIT_TOOL.Rotate:
      case EDIT_TOOL.Scale:
        return onTransformToolDown(event, font)
      case EDIT_TOOL.Select:
        return onSelectDown(event, font)
      default:
        return onDirectDown(event, font, nodeId, handleKind)
    }
  }

  function onDirectDown(
    event: React.PointerEvent<SVGSVGElement>,
    font: Point,
    nodeId: string | null,
    handleKind: 'in' | 'out' | null,
  ): void {
    if (nodeId && handleKind) {
      history.getState().begin('Move handle')
      dragRef.current = {
        kind: 'handle',
        nodeId,
        handle: handleKind,
        baseOutline: glyph.outline,
      }
      return
    }

    if (nodeId) {
      const additive = event.shiftKey || event.metaKey || event.ctrlKey
      const next = additive
        ? selectedNodes.includes(nodeId)
          ? selectedNodes.filter((id) => id !== nodeId)
          : [...selectedNodes, nodeId]
        : selectedNodes.includes(nodeId)
          ? selectedNodes
          : [nodeId]
      setSelectedNodes(next)
      history.getState().begin('Move node')
      dragRef.current = {
        kind: 'nodes',
        nodeIds: next,
        start: font,
        baseOutline: glyph.outline,
      }
      return
    }

    if (!event.shiftKey) setSelectedNodes([])
    dragRef.current = { kind: 'marquee', start: font, current: font, mode: 'nodes' }
    setMarquee({ kind: 'marquee', start: font, current: font, mode: 'nodes' })
  }

  function onSelectDown(
    event: React.PointerEvent<SVGSVGElement>,
    font: Point,
  ): void {
    const hit = hitTestContours(glyph.outline, font, HIT_PIXELS / view.zoom)
    if (!hit) {
      if (!event.shiftKey) setSelectedContours([])
      dragRef.current = {
        kind: 'marquee',
        start: font,
        current: font,
        mode: 'contours',
      }
      setMarquee({ kind: 'marquee', start: font, current: font, mode: 'contours' })
      return
    }

    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    let ids = additive
      ? selectedContours.includes(hit.contourId)
        ? selectedContours.filter((id) => id !== hit.contourId)
        : [...selectedContours, hit.contourId]
      : selectedContours.includes(hit.contourId)
        ? selectedContours
        : [hit.contourId]

    let base = glyph.outline
    // Alt-dragging leaves a copy behind, as in any vector editor.
    if (event.altKey && ids.length > 0) {
      const duplicated = duplicateContours(glyph.outline, ids)
      base = duplicated.outline
      ids = duplicated.newIds
      history.getState().begin('Duplicate contour')
      history.getState().update(editFor(base))
    } else {
      history.getState().begin('Move contour')
    }

    setSelectedContours(ids)
    dragRef.current = {
      kind: 'contours',
      contourIds: ids,
      start: font,
      baseOutline: base,
    }
  }

  function onPenDown(
    event: React.PointerEvent<SVGSVGElement>,
    font: Point,
  ): void {
    const point = event.altKey ? font : applySnap(font, true)
    const current = penRef.current

    // Clicking the first point closes the path.
    if (current && current.nodes.length >= 2) {
      const first = current.nodes[0]
      const gap = Math.hypot(first.x - font.x, first.y - font.y) * view.zoom
      if (gap <= CLOSE_PIXELS) {
        commitPen(true)
        return
      }
    }

    const node = createNode(point.x, point.y)
    const nodes = current ? [...current.nodes, node] : [node]
    setPen({ nodes })
    dragRef.current = { kind: 'pen', nodeIndex: nodes.length - 1 }
  }

  function onAnchorDown(
    event: React.PointerEvent<SVGSVGElement>,
    font: Point,
    nodeId: string | null,
  ): void {
    const id =
      nodeId ??
      (() => {
        const hit = hitTestOutline(glyph.outline, font, HIT_PIXELS / view.zoom)
        return hit ? null : null
      })()
    if (!id) return

    const found = findNode(glyph.outline, id)
    if (!found) return

    setSelectedNodes([id])
    // A click toggles the anchor's type; a drag pulls smooth handles out.
    history.getState().begin(found.node.smooth ? 'Make corner' : 'Make smooth')
    history
      .getState()
      .update(editFor(setNodeSmooth(glyph.outline, id, !found.node.smooth)))
    dragRef.current = {
      kind: 'handle',
      nodeId: id,
      handle: 'out',
      baseOutline: glyph.outline,
    }
    void event
  }

  function onKnifeDown(font: Point): void {
    const hit = hitTestOutline(glyph.outline, font, HIT_PIXELS / view.zoom)
    if (!hit) return
    const inserted = insertNode(
      glyph.outline,
      { contourIndex: hit.contourIndex, segmentIndex: hit.segmentIndex },
      hit.t,
    )
    if (!inserted.nodeId) return
    commitOutline('Cut contour', breakContourAt(inserted.outline, inserted.nodeId))
  }

  function onZoomDown(
    event: React.PointerEvent<SVGSVGElement>,
    screen: Point,
    font: Point,
  ): void {
    if (event.altKey) {
      const next = zoomAround(view, screen, 1 / 2, { min: MIN_ZOOM, max: MAX_ZOOM })
      setZoom(next.zoom)
      setPan(next.originX, next.originY)
      return
    }
    dragRef.current = { kind: 'marquee', start: font, current: font, mode: 'zoom' }
    setMarquee({ kind: 'marquee', start: font, current: font, mode: 'zoom' })
  }

  function onTransformToolDown(
    event: React.PointerEvent<SVGSVGElement>,
    font: Point,
  ): void {
    const target = currentTarget()
    if (!target) return

    // The first click with no origin placed sets one; alt-click resets it.
    if (!transformOrigin || event.altKey) {
      setTransformOrigin(font)
      return
    }

    if (tool === EDIT_TOOL.Rotate) {
      history.getState().begin('Rotate')
      setRotating(true)
      dragRef.current = {
        kind: 'rotate',
        origin: transformOrigin,
        startAngle: Math.atan2(
          font.y - transformOrigin.y,
          font.x - transformOrigin.x,
        ),
        baseOutline: glyph.outline,
        target,
      }
    } else {
      history.getState().begin('Scale')
      dragRef.current = {
        kind: 'scaleTool',
        origin: transformOrigin,
        startDistance: Math.max(
          1e-6,
          Math.hypot(font.x - transformOrigin.x, font.y - transformOrigin.y),
        ),
        baseOutline: glyph.outline,
        target,
      }
    }
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const screen = localPoint(event)
    const font = toFont(view, screen)
    setCursorScreen(screen)
    setCursor(font)

    const drag = dragRef.current
    if (!drag) {
      const element = event.target as SVGElement
      setHovered(element.getAttribute('data-node'))
      return
    }

    switch (drag.kind) {
      case 'pan':
        setPan(
          drag.originX + (event.clientX - drag.startX),
          drag.originY + (event.clientY - drag.startY),
        )
        break

      case 'guide': {
        if (!drag.id) break
        moveGuide(drag.id, drag.axis === 'x' ? font.x : font.y)
        break
      }

      case 'nodes': {
        const anchorNode = findNode(drag.baseOutline, drag.nodeIds[0])
        let dx = font.x - drag.start.x
        let dy = font.y - drag.start.y
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        if (anchorNode && !event.altKey) {
          const snapped = applySnap(
            { x: anchorNode.node.x + dx, y: anchorNode.node.y + dy },
            true,
          )
          dx = snapped.x - anchorNode.node.x
          dy = snapped.y - anchorNode.node.y
        }
        applyOutline(moveNodes(drag.baseOutline, drag.nodeIds, dx, dy))
        break
      }

      case 'contours': {
        let dx = font.x - drag.start.x
        let dy = font.y - drag.start.y
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        applyOutline(moveContours(drag.baseOutline, drag.contourIds, dx, dy))
        break
      }

      case 'handle': {
        const point = event.altKey ? font : applySnap(font, true)
        applyOutline(
          moveHandle(drag.baseOutline, drag.nodeId, drag.handle, point, {
            breakSmooth: event.altKey,
          }),
        )
        break
      }

      case 'scaleBox': {
        const anchor = anchorForHandle(drag.handle, drag.bounds)
        const axes = handleAxes(drag.handle)
        const width = drag.bounds.xMax - drag.bounds.xMin
        const height = drag.bounds.yMax - drag.bounds.yMin

        let sx = axes.x && width > 1e-6 ? (font.x - anchor.x) / (
          (drag.handle.includes('w') ? drag.bounds.xMin : drag.bounds.xMax) - anchor.x
        ) : 1
        let sy = axes.y && height > 1e-6 ? (font.y - anchor.y) / (
          (drag.handle.includes('s') ? drag.bounds.yMin : drag.bounds.yMax) - anchor.y
        ) : 1

        if (!Number.isFinite(sx)) sx = 1
        if (!Number.isFinite(sy)) sy = 1
        // Shift keeps the proportions, as everywhere else.
        if (event.shiftKey && axes.x && axes.y) {
          const uniform = Math.abs(sx) > Math.abs(sy) ? sx : sy
          sx = uniform
          sy = uniform
        }

        applyOutline(
          applyToTarget(
            drag.baseOutline,
            drag.target,
            about(scaling(sx, sy), anchor),
          ),
        )
        break
      }

      case 'rotate': {
        const angle =
          Math.atan2(font.y - drag.origin.y, font.x - drag.origin.x) -
          drag.startAngle
        let degrees = (angle * 180) / Math.PI
        // Shift snaps to 15 degree steps.
        if (event.shiftKey) degrees = Math.round(degrees / 15) * 15
        applyOutline(
          applyToTarget(
            drag.baseOutline,
            drag.target,
            about(rotation(degrees), drag.origin),
          ),
        )
        break
      }

      case 'scaleTool': {
        const distance = Math.hypot(
          font.x - drag.origin.x,
          font.y - drag.origin.y,
        )
        let factor = distance / drag.startDistance
        if (!Number.isFinite(factor) || factor <= 0) factor = 1e-3
        applyOutline(
          applyToTarget(
            drag.baseOutline,
            drag.target,
            about(scaling(factor, factor), drag.origin),
          ),
        )
        break
      }

      case 'pen': {
        const point = event.altKey ? font : applySnap(font, true)
        const current = penRef.current
        if (!current) break
        const nodes = [...current.nodes]
        const node = nodes[drag.nodeIndex]
        if (!node) break
        // A click places a corner; only a real drag pulls handles out.
        const moved = Math.hypot(point.x - node.x, point.y - node.y) * view.zoom
        if (moved < 2) break
        nodes[drag.nodeIndex] = {
          ...node,
          smooth: true,
          out: { x: point.x, y: point.y },
          in: { x: node.x * 2 - point.x, y: node.y * 2 - point.y },
        }
        setPen({ nodes })
        break
      }

      case 'marquee': {
        const next = { ...drag, current: font }
        dragRef.current = next
        setMarquee(next)
        break
      }

      case 'measure': {
        const next = { ...drag, current: font }
        dragRef.current = next
        setMeasure({ start: drag.start, current: font })
        break
      }
    }
  }

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    setActiveSnaps({ x: null, y: null })
    setRotating(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag) return

    if (
      drag.kind === 'nodes' ||
      drag.kind === 'handle' ||
      drag.kind === 'contours' ||
      drag.kind === 'scaleBox' ||
      drag.kind === 'rotate' ||
      drag.kind === 'scaleTool'
    ) {
      history.getState().end()
      return
    }

    if (drag.kind === 'marquee') {
      const rect = {
        xMin: Math.min(drag.start.x, drag.current.x),
        xMax: Math.max(drag.start.x, drag.current.x),
        yMin: Math.min(drag.start.y, drag.current.y),
        yMax: Math.max(drag.start.y, drag.current.y),
      }
      setMarquee(null)

      if (drag.mode === 'zoom') {
        const width = rect.xMax - rect.xMin
        const height = rect.yMax - rect.yMin
        if (width * view.zoom > 8 && height * view.zoom > 8) {
          const nextZoom = Math.min(
            MAX_ZOOM,
            Math.max(
              MIN_ZOOM,
              Math.min(size.width / width, (size.height - RULER_SIZE) / height),
            ),
          )
          setZoom(nextZoom)
          setPan(
            size.width / 2 - ((rect.xMin + rect.xMax) / 2) * nextZoom,
            size.height / 2 + ((rect.yMin + rect.yMax) / 2) * nextZoom,
          )
        } else {
          const next = zoomAround(view, localPoint(event), 2, {
            min: MIN_ZOOM,
            max: MAX_ZOOM,
          })
          setZoom(next.zoom)
          setPan(next.originX, next.originY)
        }
        return
      }

      if (drag.mode === 'contours') {
        const ids = contoursInRect(glyph.outline, rect)
        setSelectedContours(
          event.shiftKey ? [...new Set([...selectedContours, ...ids])] : ids,
        )
        return
      }

      const inside: string[] = []
      for (const contour of glyph.outline.contours) {
        for (const node of contour.nodes) {
          if (
            node.x >= rect.xMin &&
            node.x <= rect.xMax &&
            node.y >= rect.yMin &&
            node.y <= rect.yMax
          ) {
            inside.push(node.id)
          }
        }
      }
      setSelectedNodes(
        event.shiftKey ? [...new Set([...selectedNodes, ...inside])] : inside,
      )
      return
    }

    if (drag.kind === 'measure') setMeasure(null)
  }

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== EDIT_TOOL.Direct && tool !== EDIT_TOOL.Select) return
    const rect = containerRef.current!.getBoundingClientRect()
    const font = toFont(view, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
    const hit = hitTestOutline(glyph.outline, font, HIT_PIXELS / view.zoom)
    if (!hit) return
    const { outline, nodeId } = insertNode(
      glyph.outline,
      { contourIndex: hit.contourIndex, segmentIndex: hit.segmentIndex },
      hit.t,
    )
    commitOutline('Add node', outline)
    if (nodeId) {
      setTool(EDIT_TOOL.Direct)
      setSelectedNodes([nodeId])
    }
  }

  // Native wheel so preventDefault works.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const state = useEditorStore.getState()
      const current = { zoom: state.zoom, originX: state.panX, originY: state.panY }
      if (event.ctrlKey || event.metaKey) {
        const next = zoomAround(current, anchor, Math.exp(-event.deltaY * 0.01), {
          min: MIN_ZOOM,
          max: MAX_ZOOM,
        })
        state.setZoom(next.zoom)
        state.setPan(next.originX, next.originY)
      } else {
        state.setPan(current.originX - event.deltaX, current.originY - event.deltaY)
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // ---- Keyboard ---------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const element = event.target as HTMLElement
      if (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.isContentEditable
      ) {
        return
      }

      if (event.code === 'Space' && !event.repeat) {
        setSpaceHeld(true)
        event.preventDefault()
        return
      }

      const mod = event.metaKey || event.ctrlKey
      const state = useEditorStore.getState()

      if (mod && event.key.toLowerCase() === 'c') {
        if (state.selectedContours.length > 0) {
          clipboard.contours = glyph.outline.contours.filter((contour) =>
            state.selectedContours.includes(contour.id),
          )
          event.preventDefault()
        }
        return
      }
      if (mod && event.key.toLowerCase() === 'v') {
        if (clipboard.contours.length > 0) {
          const upm = parsed.verticalMetrics.unitsPerEm
          const pasted = appendContours(
            glyph.outline,
            clipboard.contours.map((contour) => ({
              ...contour,
              nodes: contour.nodes.map((node) => ({
                ...node,
                x: node.x + upm * 0.02,
                y: node.y - upm * 0.02,
              })),
            })),
          )
          commitOutline('Paste contour', pasted)
          event.preventDefault()
        }
        return
      }
      if (mod && event.key.toLowerCase() === 'd') {
        if (state.selectedContours.length > 0) {
          const upm = parsed.verticalMetrics.unitsPerEm
          const { outline } = duplicateContours(
            glyph.outline,
            state.selectedContours,
            { x: upm * 0.02, y: -upm * 0.02 },
          )
          commitOutline('Duplicate contour', outline)
          event.preventDefault()
        }
        return
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        if (state.tool === EDIT_TOOL.Select) {
          setSelectedContours(glyph.outline.contours.map((c) => c.id))
        } else {
          setSelectedNodes(
            glyph.outline.contours.flatMap((c) => c.nodes.map((n) => n.id)),
          )
        }
        return
      }
      if (mod) return

      if (event.key === 'Escape') {
        if (penRef.current) {
          setPen(null)
          event.preventDefault()
          return
        }
        setSelectedNodes([])
        setSelectedContours([])
        return
      }
      if (event.key === 'Enter' && penRef.current) {
        commitPen(false)
        event.preventDefault()
        return
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (state.selectedContours.length > 0) {
          event.preventDefault()
          commitOutline(
            'Delete contour',
            deleteContours(glyph.outline, state.selectedContours),
          )
          setSelectedContours([])
          return
        }
        if (state.selectedNodes.length > 0) {
          event.preventDefault()
          commitOutline('Delete node', deleteNodes(glyph.outline, state.selectedNodes))
          setSelectedNodes([])
        }
        return
      }

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
      }
      const delta = arrows[event.key]
      if (!delta) return
      event.preventDefault()
      const step = event.shiftKey ? 10 : event.altKey ? 0.5 : 1

      if (state.selectedContours.length > 0) {
        commitOutline(
          'Move contour',
          moveContours(
            glyph.outline,
            state.selectedContours,
            delta[0] * step,
            delta[1] * step,
          ),
        )
      } else if (state.selectedNodes.length > 0) {
        commitOutline(
          'Move node',
          moveNodes(glyph.outline, state.selectedNodes, delta[0] * step, delta[1] * step),
        )
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    glyph.outline,
    commitOutline,
    setSelectedNodes,
    setSelectedContours,
    penRef,
    setPen,
    commitPen,
    parsed.verticalMetrics.unitsPerEm,
  ])

  const selectedNodeSet = useMemo(() => new Set(selectedNodes), [selectedNodes])
  const selectedContourSet = useMemo(
    () => new Set(selectedContours),
    [selectedContours],
  )

  const cursorStyle = spaceHeld ? 'grab' : TOOL_CURSORS[tool as EditTool]

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-base"
      style={{ cursor: cursorStyle }}
    >
      <svg
        width={size.width}
        height={size.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setCursor(null)
          setCursorScreen(null)
        }}
        onDoubleClick={onDoubleClick}
        className="touch-none select-none"
      >
        {showGrid && (
          <GridLayer
            view={view}
            width={size.width}
            height={size.height}
            spacing={Math.max(snapGrid, parsed.verticalMetrics.unitsPerEm / 100)}
            unitsPerEm={parsed.verticalMetrics.unitsPerEm}
          />
        )}

        {showMetrics && (
          <MetricsLayer
            view={view}
            width={size.width}
            height={size.height}
            lines={metricLines}
            advanceWidth={glyph.advanceWidth}
            bounds={glyph.bounds}
            showBearings={!glyph.isEmpty}
            isEmpty={glyph.isEmpty}
          />
        )}

        {showGuides &&
          guides.map((guide) => {
            const at =
              guide.axis === 'x'
                ? toScreen(view, { x: guide.value, y: 0 }).x
                : toScreen(view, { x: 0, y: guide.value }).y
            const props = {
              className: 'stroke-ok',
              strokeWidth: 1,
              onDoubleClick: (event: React.MouseEvent) => {
                event.stopPropagation()
                removeGuide(guide.id)
              },
            }
            return guide.axis === 'x' ? (
              <line key={guide.id} x1={at} y1={RULER_SIZE} x2={at} y2={size.height} {...props} />
            ) : (
              <line key={guide.id} x1={RULER_SIZE} y1={at} x2={size.width} y2={at} {...props} />
            )
          })}

        <OutlineLayer
          outline={glyph.outline}
          view={view}
          filled={showFilled}
          showDirection={showDirection}
          highlightedContours={selectedContourSet}
        />

        {showNodes && tool !== EDIT_TOOL.Select && (
          <NodesLayer
            outline={glyph.outline}
            view={view}
            selectedIds={selectedNodeSet}
            showHandles={showHandles}
            hoveredId={hovered}
          />
        )}

        {targetBounds && (
          <TransformBox bounds={targetBounds} view={view} rotating={rotating} />
        )}

        {pen && (
          <PenOverlay pen={pen} view={view} cursor={cursor} zoomLevel={view.zoom} />
        )}

        {transformOrigin &&
          (tool === EDIT_TOOL.Rotate || tool === EDIT_TOOL.Scale) && (
            <OriginMarker point={toScreen(view, transformOrigin)} />
          )}

        {marquee && <MarqueeRect marquee={marquee} view={view} />}

        {measure && <MeasureOverlay measure={measure} view={view} />}

        {activeSnaps.x && (
          <SnapLine
            x={toScreen(view, { x: activeSnaps.x.value, y: 0 }).x}
            height={size.height}
          />
        )}
        {activeSnaps.y && (
          <SnapLine
            y={toScreen(view, { x: 0, y: activeSnaps.y.value }).y}
            width={size.width}
          />
        )}

        <RulersLayer
          view={view}
          width={size.width}
          height={size.height}
          unitsPerEm={parsed.verticalMetrics.unitsPerEm}
          cursor={cursorScreen}
        />
      </svg>

      <CursorReadout
        cursor={cursor}
        snaps={activeSnaps}
        zoom={view.zoom}
        measure={measure}
        pen={pen !== null}
      />
    </div>
  )
}

// --------------------------------------------------------------------------
// Overlays
// --------------------------------------------------------------------------

function PenOverlay({
  pen,
  view,
  cursor,
}: {
  pen: PenState
  view: ViewTransform
  cursor: Point | null
  zoomLevel: number
}) {
  const points = pen.nodes.map((node) => toScreen(view, node))
  const data = pen.nodes
    .map((node, index) => {
      const screen = points[index]
      if (index === 0) return `M${screen.x} ${screen.y}`
      const previous = pen.nodes[index - 1]
      const c1 = previous.out ? toScreen(view, previous.out) : toScreen(view, previous)
      const c2 = node.in ? toScreen(view, node.in) : screen
      return `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${screen.x} ${screen.y}`
    })
    .join('')

  const last = pen.nodes[pen.nodes.length - 1]
  const lastScreen = points[points.length - 1]
  const cursorScreen = cursor ? toScreen(view, cursor) : null

  return (
    <g className="pointer-events-none">
      <path d={data} className="fill-none stroke-accent" strokeWidth={1.5} />
      {cursorScreen && lastScreen && (
        <path
          d={`M${lastScreen.x} ${lastScreen.y} ${
            last.out
              ? `C${toScreen(view, last.out).x} ${toScreen(view, last.out).y} ${cursorScreen.x} ${cursorScreen.y} ${cursorScreen.x} ${cursorScreen.y}`
              : `L${cursorScreen.x} ${cursorScreen.y}`
          }`}
          className="fill-none stroke-accent"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}
      {pen.nodes.map((node, index) => {
        const screen = points[index]
        return (
          <g key={node.id}>
            {node.out && (
              <>
                <line
                  x1={screen.x}
                  y1={screen.y}
                  x2={toScreen(view, node.out).x}
                  y2={toScreen(view, node.out).y}
                  className="stroke-ink-faint"
                  strokeWidth={1}
                />
                <circle
                  cx={toScreen(view, node.out).x}
                  cy={toScreen(view, node.out).y}
                  r={2.5}
                  className="fill-panel stroke-ink-muted"
                  strokeWidth={1}
                />
              </>
            )}
            <rect
              x={screen.x - 3}
              y={screen.y - 3}
              width={6}
              height={6}
              className={
                index === 0
                  ? 'fill-ok stroke-ok'
                  : 'fill-panel stroke-accent'
              }
              strokeWidth={1.5}
            />
          </g>
        )
      })}
    </g>
  )
}

function OriginMarker({ point }: { point: Point }) {
  return (
    <g className="pointer-events-none">
      <circle
        cx={point.x}
        cy={point.y}
        r={5}
        className="fill-none stroke-danger"
        strokeWidth={1.5}
      />
      <line
        x1={point.x - 8}
        y1={point.y}
        x2={point.x + 8}
        y2={point.y}
        className="stroke-danger"
        strokeWidth={1}
      />
      <line
        x1={point.x}
        y1={point.y - 8}
        x2={point.x}
        y2={point.y + 8}
        className="stroke-danger"
        strokeWidth={1}
      />
    </g>
  )
}

function MarqueeRect({
  marquee,
  view,
}: {
  marquee: Drag & { kind: 'marquee' }
  view: ViewTransform
}) {
  const a = toScreen(view, marquee.start)
  const b = toScreen(view, marquee.current)
  return (
    <rect
      x={Math.min(a.x, b.x)}
      y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)}
      height={Math.abs(b.y - a.y)}
      className={
        marquee.mode === 'zoom'
          ? 'fill-none stroke-ink-muted'
          : 'fill-accent/10 stroke-accent'
      }
      strokeWidth={1}
      strokeDasharray="3 2"
    />
  )
}

function MeasureOverlay({
  measure,
  view,
}: {
  measure: { start: Point; current: Point }
  view: ViewTransform
}) {
  const a = toScreen(view, measure.start)
  const b = toScreen(view, measure.current)
  return (
    <g className="pointer-events-none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-danger" strokeWidth={1} />
      <circle cx={a.x} cy={a.y} r={3} className="fill-danger" />
      <circle cx={b.x} cy={b.y} r={3} className="fill-danger" />
    </g>
  )
}

function SnapLine({
  x,
  y,
  width,
  height,
}: {
  x?: number
  y?: number
  width?: number
  height?: number
}) {
  return x !== undefined ? (
    <line
      x1={x}
      y1={RULER_SIZE}
      x2={x}
      y2={height}
      className="stroke-danger"
      strokeWidth={1}
      strokeDasharray="2 2"
    />
  ) : (
    <line
      x1={RULER_SIZE}
      y1={y}
      x2={width}
      y2={y}
      className="stroke-danger"
      strokeWidth={1}
      strokeDasharray="2 2"
    />
  )
}

function CursorReadout({
  cursor,
  snaps,
  zoom,
  measure,
  pen,
}: {
  cursor: Point | null
  snaps: { x: SnapTarget | null; y: SnapTarget | null }
  zoom: number
  measure: { start: Point; current: Point } | null
  pen: boolean
}) {
  const distance = measure
    ? Math.hypot(
        measure.current.x - measure.start.x,
        measure.current.y - measure.start.y,
      )
    : null
  const angle = measure
    ? (Math.atan2(
        measure.current.y - measure.start.y,
        measure.current.x - measure.start.x,
      ) *
        180) /
      Math.PI
    : null

  return (
    <div className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-3 rounded border border-line bg-panel/90 px-2 py-1 font-mono text-2xs text-ink-muted backdrop-blur-sm">
      {pen && <span className="text-accent">⏎ finish · esc cancel</span>}
      {distance !== null && (
        <span className="text-danger">
          {Math.round(distance)} u · {angle!.toFixed(1)}°
        </span>
      )}
      {cursor && (
        <span className="tabular">
          {Math.round(cursor.x)}, {Math.round(cursor.y)}
        </span>
      )}
      {(snaps.x || snaps.y) && (
        <span className="text-danger">
          {[snaps.x?.label, snaps.y?.label].filter(Boolean).join(' · ')}
        </span>
      )}
      <span className="tabular text-ink-faint">{Math.round(zoom * 100)}%</span>
    </div>
  )
}
