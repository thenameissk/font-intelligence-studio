import { memo, useMemo } from 'react'
import type { Outline, Point } from '@/types/geometry'
import type { ViewTransform } from '../canvasTransform'
import { toScreen } from '../canvasTransform'
import { cn } from '@/utils/cn'

interface NodeHandle {
  nodeId: string
  contourIndex: number
  nodeIndex: number
  kind: 'in' | 'out'
  anchor: Point
  handle: Point
}

interface ScreenNode {
  id: string
  contourIndex: number
  nodeIndex: number
  point: Point
  smooth: boolean
  selected: boolean
}

function projectNodes(
  outline: Outline,
  view: ViewTransform,
  selectedIds: ReadonlySet<string>,
): { nodes: ScreenNode[]; handles: NodeHandle[] } {
  const nodes: ScreenNode[] = []
  const handles: NodeHandle[] = []

  outline.contours.forEach((contour, contourIndex) => {
    contour.nodes.forEach((node, nodeIndex) => {
      const anchor = toScreen(view, node)
      nodes.push({
        id: node.id,
        contourIndex,
        nodeIndex,
        point: anchor,
        smooth: node.smooth,
        selected: selectedIds.has(node.id),
      })
      if (node.in) {
        handles.push({
          nodeId: node.id,
          contourIndex,
          nodeIndex,
          kind: 'in',
          anchor,
          handle: toScreen(view, node.in),
        })
      }
      if (node.out) {
        handles.push({
          nodeId: node.id,
          contourIndex,
          nodeIndex,
          kind: 'out',
          anchor,
          handle: toScreen(view, node.out),
        })
      }
    })
  })

  return { nodes, handles }
}

/**
 * On-curve nodes and their Bezier handles.
 *
 * Corners are squares and smooth points are circles, the convention every
 * vector editor uses, so the node type is readable at a glance.
 */
export const NodesLayer = memo(function NodesLayer({
  outline,
  view,
  selectedIds,
  showHandles,
  hoveredId,
}: {
  outline: Outline
  view: ViewTransform
  selectedIds: ReadonlySet<string>
  showHandles: boolean
  hoveredId: string | null
}) {
  const { nodes, handles } = useMemo(
    () => projectNodes(outline, view, selectedIds),
    [outline, view, selectedIds],
  )

  return (
    <g>
      {showHandles &&
        handles.map((handle) => {
          const active =
            selectedIds.has(handle.nodeId) || hoveredId === handle.nodeId
          return (
            <g key={`${handle.nodeId}-${handle.kind}`} opacity={active ? 1 : 0.45}>
              <line
                x1={handle.anchor.x}
                y1={handle.anchor.y}
                x2={handle.handle.x}
                y2={handle.handle.y}
                className="stroke-ink-faint"
                strokeWidth={1}
              />
              <circle
                cx={handle.handle.x}
                cy={handle.handle.y}
                r={3}
                data-handle={handle.kind}
                data-node={handle.nodeId}
                className="cursor-grab fill-panel stroke-ink-muted"
                strokeWidth={1.25}
              />
            </g>
          )
        })}

      {nodes.map((node) =>
        node.smooth ? (
          <circle
            key={node.id}
            cx={node.point.x}
            cy={node.point.y}
            r={node.selected ? 4.5 : 3.5}
            data-node={node.id}
            className={cn(
              'cursor-pointer stroke-2',
              node.selected
                ? 'fill-accent stroke-accent'
                : hoveredId === node.id
                  ? 'fill-accent-soft stroke-accent'
                  : 'fill-panel stroke-accent',
            )}
          />
        ) : (
          <rect
            key={node.id}
            x={node.point.x - (node.selected ? 4.5 : 3.5)}
            y={node.point.y - (node.selected ? 4.5 : 3.5)}
            width={node.selected ? 9 : 7}
            height={node.selected ? 9 : 7}
            data-node={node.id}
            className={cn(
              'cursor-pointer stroke-2',
              node.selected
                ? 'fill-accent stroke-accent'
                : hoveredId === node.id
                  ? 'fill-accent-soft stroke-accent'
                  : 'fill-panel stroke-accent',
            )}
          />
        ),
      )}
    </g>
  )
})
