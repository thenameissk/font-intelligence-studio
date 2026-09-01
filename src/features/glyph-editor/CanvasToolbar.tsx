import {
  ArrowLeftRight,
  Crosshair,
  Grid3x3,
  Magnet,
  Maximize,
  Minus,
  Plus,
  Ruler,
  Spline,
  Square,
  Waypoints,
} from 'lucide-react'
import { IconButton } from '@/components/ui/Button'
import { useEditorStore } from '@/store/editorStore'

/** View controls for the glyph canvas. */
export function CanvasToolbar() {
  const zoom = useEditorStore((s) => s.zoom)
  const zoomBy = useEditorStore((s) => s.zoomBy)
  const requestFit = useEditorStore((s) => s.requestFit)
  const toggle = useEditorStore((s) => s.toggle)

  const showNodes = useEditorStore((s) => s.showNodes)
  const showHandles = useEditorStore((s) => s.showHandles)
  const showMetrics = useEditorStore((s) => s.showMetrics)
  const showGuides = useEditorStore((s) => s.showGuides)
  const showFilled = useEditorStore((s) => s.showFilled)
  const showDirection = useEditorStore((s) => s.showContourDirection)
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const showGrid = useEditorStore((s) => s.showGrid)
  const toggleGrid = useEditorStore((s) => s.toggleGrid)

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-2">
      <IconButton label="Zoom out (−)" onClick={() => zoomBy(1 / 1.25)}>
        <Minus size={13} />
      </IconButton>
      <span className="w-11 text-center font-mono text-2xs tabular text-ink-muted">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton label="Zoom in (+)" onClick={() => zoomBy(1.25)}>
        <Plus size={13} />
      </IconButton>
      <IconButton label="Fit to glyph (0)" onClick={requestFit}>
        <Maximize size={13} />
      </IconButton>

      <div className="mx-1.5 h-4 w-px bg-line" />

      <IconButton
        label="Fill outline"
        active={showFilled}
        onClick={() => toggle('showFilled')}
      >
        <Square size={13} />
      </IconButton>
      <IconButton
        label="Show nodes"
        active={showNodes}
        onClick={() => toggle('showNodes')}
      >
        <Waypoints size={13} />
      </IconButton>
      <IconButton
        label="Show handles"
        active={showHandles}
        onClick={() => toggle('showHandles')}
      >
        <Spline size={13} />
      </IconButton>
      <IconButton
        label="Show contour direction"
        active={showDirection}
        onClick={() => toggle('showContourDirection')}
      >
        <ArrowLeftRight size={13} />
      </IconButton>

      <div className="mx-1.5 h-4 w-px bg-line" />

      <IconButton
        label="Show metrics"
        active={showMetrics}
        onClick={() => toggle('showMetrics')}
      >
        <Ruler size={13} />
      </IconButton>
      <IconButton
        label="Show guides"
        active={showGuides}
        onClick={() => toggle('showGuides')}
      >
        <Crosshair size={13} />
      </IconButton>
      <IconButton
        label="Snapping"
        active={snapEnabled}
        onClick={() => toggle('snapEnabled')}
      >
        <Magnet size={13} />
      </IconButton>
      <IconButton label="Unit grid" active={showGrid} onClick={toggleGrid}>
        <Grid3x3 size={13} />
      </IconButton>

      <div className="flex-1" />

      <span className="flex items-center gap-1 font-mono text-2xs text-ink-faint">
        <Grid3x3 size={11} />
        drag from a ruler to add a guide
      </span>
    </div>
  )
}
