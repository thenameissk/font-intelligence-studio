import { useMemo, useState } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Combine,
  Copy,
  Link,
  Minimize2,
  Scissors,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import { countNodes } from '@/engine/geometry/outline'
import {
  alignNodes,
  averageNodes,
  deleteContours,
  duplicateContours,
  NODE_ALIGN,
  openEndpoints,
  reorderContour,
  reverseContours,
  type NodeAlign,
} from '@/engine/geometry/pathOps'
import { breakContourAt, joinContours } from '@/engine/geometry/edit'
import { hasOverlap, removeOverlap } from '@/engine/geometry/boolean'
import { simplifyOutline } from '@/engine/geometry/simplify'
import { Button, IconButton } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { PanelSection, Row } from '@/components/ui/Panel'
import { useEditorStore } from '@/store/editorStore'
import { useHistoryStore } from '@/store/historyStore'

/**
 * Path operations: the Object and Path menu of a vector editor, scoped to
 * what is meaningful for a glyph.
 */
export function PathOpsPanel({
  glyph,
  unitsPerEm,
}: {
  glyph: ResolvedGlyph
  unitsPerEm: number
}) {
  const commit = useHistoryStore((s) => s.commit)
  const selectedNodes = useEditorStore((s) => s.selectedNodes)
  const setSelectedNodes = useEditorStore((s) => s.setSelectedNodes)
  const selectedContours = useEditorStore((s) => s.selectedContours)
  const setSelectedContours = useEditorStore((s) => s.setSelectedContours)

  const [simplifyTolerance, setSimplifyTolerance] = useState(
    Math.max(1, Math.round(unitsPerEm / 1000)),
  )

  const apply = (label: string, outline: ReturnType<typeof simplifyOutline>): void => {
    commit(label, {
      [glyph.index]: { outline, advanceWidth: glyph.advanceWidth },
    })
  }

  const overlapping = useMemo(
    () => (glyph.isEmpty ? false : hasOverlap(glyph.outline)),
    [glyph.outline, glyph.isEmpty],
  )

  const endpoints = useMemo(() => openEndpoints(glyph.outline), [glyph.outline])
  const joinable = useMemo(() => {
    const selected = new Set(selectedNodes)
    return endpoints.filter((endpoint) => selected.has(endpoint.nodeId))
  }, [endpoints, selectedNodes])

  const nodeCount = countNodes(glyph.outline)
  const hasNodeSelection = selectedNodes.length >= 2
  const hasContourSelection = selectedContours.length > 0

  if (glyph.isEmpty && glyph.outline.contours.length === 0) {
    return (
      <PanelSection title="Paths">
        <p className="text-2xs text-ink-faint">
          This glyph has no outline. Draw one with the pen tool.
        </p>
      </PanelSection>
    )
  }

  return (
    <PanelSection title="Paths" defaultOpen={false}>
      <p className="mb-2 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
        Clean up
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          disabled={!overlapping}
          title={
            overlapping
              ? 'Merge overlapping contours into one outline'
              : 'Nothing overlaps in this glyph'
          }
          onClick={() => apply('Remove overlap', removeOverlap(glyph.outline))}
        >
          <Combine size={11} />
          Remove overlap
        </Button>
      </div>

      <Row label="Simplify to">
        <NumberInput
          ariaLabel="Simplify tolerance"
          value={simplifyTolerance}
          min={0}
          step={1}
          suffix="u"
          onChange={setSimplifyTolerance}
        />
      </Row>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          title="Fit fewer curves through the same path"
          onClick={() =>
            apply(
              'Simplify path',
              simplifyOutline(glyph.outline, { tolerance: simplifyTolerance }),
            )
          }
        >
          <Minimize2 size={11} />
          Simplify ({nodeCount} nodes)
        </Button>
      </div>

      {hasNodeSelection && (
        <>
          <p className="mt-3 mb-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
            Align {selectedNodes.length} anchors
          </p>
          <div className="flex flex-wrap gap-0.5">
            <AlignButton
              label="Align left"
              alignment={NODE_ALIGN.Left}
              onApply={(a) => apply('Align anchors', alignNodes(glyph.outline, selectedNodes, a))}
            >
              <AlignStartVertical size={12} />
            </AlignButton>
            <AlignButton
              label="Align horizontal centres"
              alignment={NODE_ALIGN.HorizontalCenter}
              onApply={(a) => apply('Align anchors', alignNodes(glyph.outline, selectedNodes, a))}
            >
              <AlignCenterVertical size={12} />
            </AlignButton>
            <AlignButton
              label="Align right"
              alignment={NODE_ALIGN.Right}
              onApply={(a) => apply('Align anchors', alignNodes(glyph.outline, selectedNodes, a))}
            >
              <AlignEndVertical size={12} />
            </AlignButton>
            <span className="mx-1 w-px bg-line" />
            <AlignButton
              label="Align top"
              alignment={NODE_ALIGN.Top}
              onApply={(a) => apply('Align anchors', alignNodes(glyph.outline, selectedNodes, a))}
            >
              <AlignStartHorizontal size={12} />
            </AlignButton>
            <AlignButton
              label="Align vertical centres"
              alignment={NODE_ALIGN.VerticalCenter}
              onApply={(a) => apply('Align anchors', alignNodes(glyph.outline, selectedNodes, a))}
            >
              <AlignCenterHorizontal size={12} />
            </AlignButton>
            <AlignButton
              label="Align bottom"
              alignment={NODE_ALIGN.Bottom}
              onApply={(a) => apply('Align anchors', alignNodes(glyph.outline, selectedNodes, a))}
            >
              <AlignEndHorizontal size={12} />
            </AlignButton>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button
              size="sm"
              title="Move the selected anchors onto their shared average"
              onClick={() =>
                apply('Average anchors', averageNodes(glyph.outline, selectedNodes, 'both'))
              }
            >
              Average
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply('Average horizontally', averageNodes(glyph.outline, selectedNodes, 'x'))
              }
            >
              Average X
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply('Average vertically', averageNodes(glyph.outline, selectedNodes, 'y'))
              }
            >
              Average Y
            </Button>
          </div>
        </>
      )}

      {joinable.length === 2 && (
        <div className="mt-2">
          <Button
            size="sm"
            title="Join the two selected open endpoints"
            onClick={() => {
              apply(
                'Join paths',
                joinContours(glyph.outline, joinable[0].nodeId, joinable[1].nodeId),
              )
              setSelectedNodes([])
            }}
          >
            <Link size={11} />
            Join endpoints
          </Button>
        </div>
      )}

      {selectedNodes.length === 1 && (
        <div className="mt-2">
          <Button
            size="sm"
            title="Open the contour at this anchor"
            onClick={() =>
              apply('Cut path', breakContourAt(glyph.outline, selectedNodes[0]))
            }
          >
            <Scissors size={11} />
            Cut here
          </Button>
        </div>
      )}

      <p className="mt-3 mb-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
        Contours
      </p>
      {hasContourSelection ? (
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            onClick={() => {
              const { outline, newIds } = duplicateContours(
                glyph.outline,
                selectedContours,
                { x: unitsPerEm * 0.02, y: -unitsPerEm * 0.02 },
              )
              apply('Duplicate contour', outline)
              setSelectedContours(newIds)
            }}
          >
            <Copy size={11} />
            Duplicate
          </Button>
          <Button
            size="sm"
            title="Flip the drawing direction, which swaps ink and counter"
            onClick={() =>
              apply(
                'Reverse direction',
                reverseContours(glyph.outline, selectedContours),
              )
            }
          >
            <Undo2 size={11} />
            Reverse
          </Button>
          <IconButton
            label="Bring to front"
            onClick={() =>
              apply(
                'Bring to front',
                reorderContour(glyph.outline, selectedContours[0], 'front'),
              )
            }
          >
            <ArrowUpToLine size={12} />
          </IconButton>
          <IconButton
            label="Send to back"
            onClick={() =>
              apply(
                'Send to back',
                reorderContour(glyph.outline, selectedContours[0], 'back'),
              )
            }
          >
            <ArrowDownToLine size={12} />
          </IconButton>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              apply('Delete contour', deleteContours(glyph.outline, selectedContours))
              setSelectedContours([])
            }}
          >
            <Trash2 size={11} />
            Delete
          </Button>
        </div>
      ) : (
        <p className="text-2xs text-ink-faint">
          Pick contours with the selection tool (V) to duplicate, reverse,
          reorder or delete them.
        </p>
      )}
    </PanelSection>
  )
}

function AlignButton({
  label,
  alignment,
  onApply,
  children,
}: {
  label: string
  alignment: NodeAlign
  onApply: (alignment: NodeAlign) => void
  children: React.ReactNode
}) {
  return (
    <IconButton label={label} onClick={() => onApply(alignment)}>
      {children}
    </IconButton>
  )
}
