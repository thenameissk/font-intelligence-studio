import { RotateCcw } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import { CATEGORY_LABELS } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import {
  categorizeCodepoint,
  formatCodepoint,
  unicodeBlockName,
} from '@/engine/parser/unicode'
import {
  contourDirection,
  contourSegments,
  contourSignedArea,
  countNodes,
} from '@/engine/geometry/outline'
import {
  setAdvanceWidth,
  setLeftSideBearing,
  setRightSideBearing,
} from '@/engine/transforms/metrics'
import { setNodeSmooth } from '@/engine/geometry/edit'
import { NumberInput } from '@/components/ui/NumberInput'
import { Button } from '@/components/ui/Button'
import { EmptyHint, PanelSection, Row, Value } from '@/components/ui/Panel'
import { useEditorStore } from '@/store/editorStore'
import { useHistoryStore } from '@/store/historyStore'
import { formatUnits } from '@/utils/format'

export function Inspector({
  parsed,
  glyph,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph | null
}) {
  if (!glyph) {
    return <EmptyHint>Select a glyph to see its properties.</EmptyHint>
  }
  return <GlyphInspector parsed={parsed} glyph={glyph} />
}

function GlyphInspector({
  parsed,
  glyph,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
}) {
  const commit = useHistoryStore((s) => s.commit)
  const selectedNodes = useEditorStore((s) => s.selectedNodes)
  const setSelectedNodes = useEditorStore((s) => s.setSelectedNodes)

  const apply = (label: string, edit: ReturnType<typeof setAdvanceWidth>): void => {
    commit(label, { [glyph.index]: edit })
  }

  const revert = (): void => {
    commit('Revert glyph', { [glyph.index]: null })
    setSelectedNodes([])
  }

  const nodeCount = countNodes(glyph.outline)
  const selectedNode =
    selectedNodes.length === 1
      ? glyph.outline.contours
          .flatMap((c) => c.nodes)
          .find((n) => n.id === selectedNodes[0])
      : undefined

  return (
    <div className="flex flex-col">
      <PanelSection title="Glyph">
        <Row label="Name">
          <Value mono>{glyph.name}</Value>
        </Row>
        <Row label="Unicode">
          <Value mono>{formatCodepoint(glyph.unicode)}</Value>
        </Row>
        {glyph.unicodes.length > 1 && (
          <Row label="Also mapped">
            <Value mono muted>
              {glyph.unicodes.slice(1).map(formatCodepoint).join(', ')}
            </Value>
          </Row>
        )}
        <Row label="Glyph index">
          <Value mono>{glyph.index}</Value>
        </Row>
        <Row label="Category">
          <Value>{CATEGORY_LABELS[categorizeCodepoint(glyph.unicode)]}</Value>
        </Row>
        <Row label="Unicode block">
          <Value muted>{unicodeBlockName(glyph.unicode)}</Value>
        </Row>
        {glyph.isComposite && (
          <Row label="Composite" title="Built from references to other glyphs">
            <Value muted>
              {glyph.components.length} component
              {glyph.components.length === 1 ? '' : 's'}
            </Value>
          </Row>
        )}
        {glyph.modified && (
          <div className="mt-2">
            <Button size="sm" variant="danger" onClick={revert}>
              <RotateCcw size={11} />
              Revert to original
            </Button>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Metrics">
        <Row label="Advance width">
          <NumberInput
            ariaLabel="Advance width"
            value={glyph.advanceWidth}
            onChange={(value) =>
              apply('Change advance width', setAdvanceWidth(glyph, value))
            }
            suffix="u"
          />
        </Row>
        <Row
          label="Left bearing"
          title="Moves the outline horizontally; the advance width is unchanged"
        >
          <NumberInput
            ariaLabel="Left side bearing"
            value={Math.round(glyph.leftSideBearing)}
            disabled={glyph.isEmpty}
            onChange={(value) =>
              apply('Change left bearing', setLeftSideBearing(glyph, value))
            }
            suffix="u"
          />
        </Row>
        <Row
          label="Right bearing"
          title="Changes the advance width; the outline is unchanged"
        >
          <NumberInput
            ariaLabel="Right side bearing"
            value={Math.round(glyph.rightSideBearing)}
            disabled={glyph.isEmpty}
            onChange={(value) =>
              apply('Change right bearing', setRightSideBearing(glyph, value))
            }
            suffix="u"
          />
        </Row>
        <Row label="Bounds x">
          <Value mono muted>
            {formatUnits(glyph.bounds.xMin)} → {formatUnits(glyph.bounds.xMax)}
          </Value>
        </Row>
        <Row label="Bounds y">
          <Value mono muted>
            {formatUnits(glyph.bounds.yMin)} → {formatUnits(glyph.bounds.yMax)}
          </Value>
        </Row>
        <Row label="Vertical origin">
          <Value muted>
            {parsed.metadata.tables.some((t) => t.tag === 'vmtx')
              ? 'defined in vmtx'
              : 'not defined'}
          </Value>
        </Row>
      </PanelSection>

      <PanelSection title="Contours">
        {glyph.outline.contours.length === 0 ? (
          <p className="text-2xs text-ink-faint">This glyph has no outline.</p>
        ) : (
          <>
            <Row label="Contours">
              <Value mono>{glyph.outline.contours.length}</Value>
            </Row>
            <Row label="Nodes">
              <Value mono>{nodeCount}</Value>
            </Row>
            <div className="mt-1 space-y-1">
              {glyph.outline.contours.map((contour, index) => {
                const direction = contourDirection(contour)
                return (
                  <div
                    key={contour.id}
                    className="flex items-center gap-2 rounded border border-line px-1.5 py-1"
                  >
                    <span className="font-mono text-2xs text-ink-faint">
                      #{index + 1}
                    </span>
                    <span className="text-2xs text-ink-muted">
                      {contour.nodes.length} nodes ·{' '}
                      {contourSegments(contour).length} segments
                    </span>
                    <span className="flex-1" />
                    <span
                      className={
                        direction === 'ccw'
                          ? 'font-mono text-2xs text-ok'
                          : 'font-mono text-2xs text-warn'
                      }
                      title={`Signed area ${Math.round(contourSignedArea(contour))}`}
                    >
                      {direction}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </PanelSection>

      {selectedNodes.length > 0 && (
        <PanelSection title={`Selection (${selectedNodes.length})`}>
          {selectedNode ? (
            <>
              <Row label="Position">
                <Value mono>
                  {formatUnits(selectedNode.x)}, {formatUnits(selectedNode.y)}
                </Value>
              </Row>
              <Row label="Type">
                <Value>{selectedNode.smooth ? 'Smooth' : 'Corner'}</Value>
              </Row>
              <Row label="Handles">
                <Value muted>
                  {[selectedNode.in ? 'in' : null, selectedNode.out ? 'out' : null]
                    .filter(Boolean)
                    .join(' + ') || 'none'}
                </Value>
              </Row>
              <div className="mt-2 flex gap-1">
                <Button
                  size="sm"
                  onClick={() =>
                    commit(
                      selectedNode.smooth ? 'Make corner' : 'Make smooth',
                      {
                        [glyph.index]: {
                          outline: setNodeSmooth(
                            glyph.outline,
                            selectedNode.id,
                            !selectedNode.smooth,
                          ),
                          advanceWidth: glyph.advanceWidth,
                        },
                      },
                    )
                  }
                >
                  {selectedNode.smooth ? 'Make corner' : 'Make smooth'}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-2xs text-ink-muted">
              {selectedNodes.length} nodes selected. Drag to move, or use the
              arrow keys.
            </p>
          )}
        </PanelSection>
      )}
    </div>
  )
}
