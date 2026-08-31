import {
  Hand,
  MousePointer2,
  MousePointerClick,
  PenTool,
  RotateCw,
  Ruler,
  Scaling,
  Scissors,
  Spline,
  ZoomIn,
} from 'lucide-react'
import { EDIT_TOOL, useEditorStore, type EditTool } from '@/store/editorStore'
import { cn } from '@/utils/cn'

interface ToolDefinition {
  tool: EditTool
  label: string
  shortcut: string
  hint: string
  icon: React.ReactNode
}

const TOOLS: ToolDefinition[][] = [
  [
    {
      tool: EDIT_TOOL.Select,
      label: 'Selection',
      shortcut: 'V',
      hint: 'Select and move whole contours, with a transform box',
      icon: <MousePointer2 size={14} />,
    },
    {
      tool: EDIT_TOOL.Direct,
      label: 'Direct selection',
      shortcut: 'A',
      hint: 'Select and move anchors and handles',
      icon: <MousePointerClick size={14} />,
    },
  ],
  [
    {
      tool: EDIT_TOOL.Pen,
      label: 'Pen',
      shortcut: 'P',
      hint: 'Click for a corner, drag for a curve, click the start to close',
      icon: <PenTool size={14} />,
    },
    {
      tool: EDIT_TOOL.Anchor,
      label: 'Anchor point',
      shortcut: 'C',
      hint: 'Click an anchor to switch corner and smooth; drag to pull handles',
      icon: <Spline size={14} />,
    },
    {
      tool: EDIT_TOOL.Knife,
      label: 'Scissors',
      shortcut: 'K',
      hint: 'Click a path to cut it open at that point',
      icon: <Scissors size={14} />,
    },
  ],
  [
    {
      tool: EDIT_TOOL.Rotate,
      label: 'Rotate',
      shortcut: 'R',
      hint: 'Drag to rotate the selection; click first to place the origin',
      icon: <RotateCw size={14} />,
    },
    {
      tool: EDIT_TOOL.Scale,
      label: 'Scale',
      shortcut: 'S',
      hint: 'Drag to scale the selection; click first to place the origin',
      icon: <Scaling size={14} />,
    },
    {
      tool: EDIT_TOOL.Measure,
      label: 'Measure',
      shortcut: 'I',
      hint: 'Drag to measure a distance and angle',
      icon: <Ruler size={14} />,
    },
  ],
  [
    {
      tool: EDIT_TOOL.Hand,
      label: 'Hand',
      shortcut: 'H',
      hint: 'Pan the canvas (or hold space with any tool)',
      icon: <Hand size={14} />,
    },
    {
      tool: EDIT_TOOL.Zoom,
      label: 'Zoom',
      shortcut: 'Z',
      hint: 'Click to zoom in, alt-click to zoom out, drag a box to fit',
      icon: <ZoomIn size={14} />,
    },
  ],
]

/** The tool palette, down the left edge of the canvas. */
export function ToolPalette() {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)

  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-panel py-1.5">
      {TOOLS.map((group, index) => (
        <div key={index} className="flex flex-col items-center gap-0.5">
          {index > 0 && <div className="my-1 h-px w-5 bg-line" />}
          {group.map((definition) => (
            <button
              key={definition.tool}
              type="button"
              title={`${definition.label} (${definition.shortcut})\n${definition.hint}`}
              aria-label={definition.label}
              aria-pressed={tool === definition.tool}
              onClick={() => setTool(definition.tool)}
              className={cn(
                'relative flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                tool === definition.tool
                  ? 'bg-accent text-on-accent'
                  : 'text-ink-muted hover:bg-hover hover:text-ink',
              )}
            >
              {definition.icon}
              <span
                className={cn(
                  'absolute right-0.5 bottom-0 font-mono text-[7px] leading-none',
                  tool === definition.tool ? 'text-on-accent/70' : 'text-ink-faint',
                )}
              >
                {definition.shortcut}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
