import { useMemo } from 'react'
import type { ResolvedGlyph } from '@/types/font'
import type { OutlineNode } from '@/types/geometry'
import { findNode, moveNodes, setNodeSmooth } from '@/engine/geometry/edit'
import { NumberInput } from '@/components/ui/NumberInput'
import { PanelSection, Row } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { useEditorStore } from '@/store/editorStore'
import { useHistoryStore } from '@/store/historyStore'

/**
 * Numeric control over the selected anchor and its handles.
 *
 * Dragging is how a curve gets found; typing is how it gets finished. A
 * stem that must sit at exactly 120 units, or a handle that must be exactly
 * horizontal so a curve stays flat at its extreme, cannot be done reliably
 * by hand at any zoom.
 *
 * Handles are shown in polar form because that is how they are reasoned
 * about: an extreme point needs an angle of exactly 0 or 90 degrees, and
 * the tension is the length.
 */
export function AnchorInspector({ glyph }: { glyph: ResolvedGlyph }) {
  const selected = useEditorStore((s) => s.selectedNodes)
  const commit = useHistoryStore((s) => s.commit)

  const found = useMemo(
    () => (selected.length === 1 ? findNode(glyph.outline, selected[0]) : null),
    [glyph.outline, selected],
  )

  if (selected.length === 0) return null

  const write = (label: string, outline: typeof glyph.outline): void => {
    commit(label, {
      [glyph.index]: { outline, advanceWidth: glyph.advanceWidth },
    })
  }

  if (selected.length > 1 || !found) {
    return (
      <PanelSection title="Anchors">
        <p className="text-2xs text-ink-muted">
          {selected.length} anchors selected. Use the transform panel, or the
          path operations, to move them together.
        </p>
      </PanelSection>
    )
  }

  const node = found.node

  const moveTo = (x: number, y: number): void => {
    write('Set anchor position', moveNodes(glyph.outline, [node.id], x - node.x, y - node.y))
  }

  const setHandle = (which: 'in' | 'out', next: OutlineNode['in']): void => {
    const outline = {
      contours: glyph.outline.contours.map((contour) => ({
        ...contour,
        nodes: contour.nodes.map((n) =>
          n.id === node.id ? { ...n, [which]: next } : n,
        ),
      })),
    }
    write(next === null ? 'Remove handle' : 'Set handle', outline)
  }

  return (
    <PanelSection title="Anchor">
      <Row label="X">
        <NumberInput
          ariaLabel="Anchor X"
          value={node.x}
          onChange={(x) => moveTo(x, node.y)}
          suffix="u"
        />
      </Row>
      <Row label="Y">
        <NumberInput
          ariaLabel="Anchor Y"
          value={node.y}
          onChange={(y) => moveTo(node.x, y)}
          suffix="u"
        />
      </Row>

      <Row label="Type">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={node.smooth ? 'primary' : 'default'}
            onClick={() =>
              write('Make smooth', setNodeSmooth(glyph.outline, node.id, true))
            }
          >
            Smooth
          </Button>
          <Button
            size="sm"
            variant={!node.smooth ? 'primary' : 'default'}
            onClick={() =>
              write('Make corner', setNodeSmooth(glyph.outline, node.id, false))
            }
          >
            Corner
          </Button>
        </div>
      </Row>

      <HandleControls
        label="Incoming"
        anchor={node}
        handle={node.in}
        onChange={(next) => setHandle('in', next)}
      />
      <HandleControls
        label="Outgoing"
        anchor={node}
        handle={node.out}
        onChange={(next) => setHandle('out', next)}
      />
    </PanelSection>
  )
}

function HandleControls({
  label,
  anchor,
  handle,
  onChange,
}: {
  label: string
  anchor: OutlineNode
  handle: OutlineNode['in']
  onChange: (next: OutlineNode['in']) => void
}) {
  if (!handle) {
    return (
      <Row label={label}>
        <span className="flex items-center gap-2">
          <span className="text-2xs text-ink-faint">straight</span>
          <Button
            size="sm"
            onClick={() =>
              // A short handle along the existing direction, as a starting
              // point that does not visibly change the curve.
              onChange({ x: anchor.x + 40, y: anchor.y })
            }
          >
            Add
          </Button>
        </span>
      </Row>
    )
  }

  const dx = handle.x - anchor.x
  const dy = handle.y - anchor.y
  const length = Math.hypot(dx, dy)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI

  const setPolar = (nextLength: number, nextAngle: number): void => {
    const radians = (nextAngle * Math.PI) / 180
    onChange({
      x: anchor.x + Math.cos(radians) * nextLength,
      y: anchor.y + Math.sin(radians) * nextLength,
    })
  }

  return (
    <>
      <Row label={`${label} length`}>
        <NumberInput
          ariaLabel={`${label} handle length`}
          value={length}
          min={0}
          onChange={(next) => setPolar(next, angle)}
          suffix="u"
        />
      </Row>
      <Row label={`${label} angle`}>
        <span className="flex items-center gap-1">
          <NumberInput
            ariaLabel={`${label} handle angle`}
            value={angle}
            precision={1}
            step={1}
            onChange={(next) => setPolar(length, next)}
            suffix="°"
          />
          {/* Snapping a handle flat is how an extreme point is made to sit
              exactly on the bounding box, which matters for hinting and for
              clean interpolation. */}
          <Button
            size="sm"
            title="Snap this handle to the nearest right angle"
            onClick={() => setPolar(length, Math.round(angle / 90) * 90)}
          >
            ⟂
          </Button>
          <Button size="sm" title="Remove this handle" onClick={() => onChange(null)}>
            ×
          </Button>
        </span>
      </Row>
    </>
  )
}
