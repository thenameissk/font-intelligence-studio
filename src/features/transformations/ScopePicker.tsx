import { useMemo } from 'react'
import type { ResolvedGlyph, VerticalMetrics } from '@/types/font'
import {
  describeScope,
  metricBands,
  resolveScope,
  WHOLE_GLYPH,
  type EditScope,
} from '@/engine/transforms/scope'
import { useEditorStore } from '@/store/editorStore'
import { cn } from '@/utils/cn'

/**
 * Chooses which part of the glyph a change applies to.
 *
 * Shown wherever a transformation is offered, because "apply this to the
 * whole letter" is usually not what a designer means. The readout underneath
 * says exactly how many anchors are in scope, so an empty or unexpectedly
 * broad selection is visible before anything is committed rather than after.
 */
export function ScopePicker({
  glyph,
  metrics,
  scope,
  onChange,
}: {
  glyph: ResolvedGlyph
  metrics: VerticalMetrics
  scope: EditScope
  onChange: (scope: EditScope) => void
}) {
  const selectedNodes = useEditorStore((s) => s.selectedNodes)
  const selectedContours = useEditorStore((s) => s.selectedContours)

  const bands = useMemo(() => metricBands(metrics), [metrics])
  const resolved = useMemo(
    () => resolveScope(glyph.outline, scope),
    [glyph.outline, scope],
  )

  const option = (
    label: string,
    value: EditScope,
    enabled: boolean,
    title?: string,
  ) => {
    const active = JSON.stringify(scope) === JSON.stringify(value)
    return (
      <button
        key={label}
        type="button"
        disabled={!enabled}
        title={title}
        onClick={() => onChange(value)}
        className={cn(
          'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
          active
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line bg-elevated text-ink-muted hover:bg-hover hover:text-ink',
          !enabled && 'cursor-not-allowed opacity-35 hover:bg-elevated',
        )}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="mb-2">
      <p className="mb-1 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
        Apply to
      </p>
      <div className="flex flex-wrap gap-1">
        {option('Whole glyph', WHOLE_GLYPH, true)}
        {option(
          `Selection (${selectedNodes.length})`,
          { kind: 'selection', nodeIds: selectedNodes },
          selectedNodes.length > 0,
          selectedNodes.length === 0
            ? 'Select anchors with the direct selection tool (A)'
            : undefined,
        )}
        {option(
          `Contours (${selectedContours.length})`,
          { kind: 'contours', contourIds: selectedContours },
          selectedContours.length > 0,
          selectedContours.length === 0
            ? 'Select contours with the selection tool (V)'
            : undefined,
        )}
        {bands.map((band) =>
          option(band.label, { kind: 'band', from: band.from, to: band.to }, true),
        )}
      </div>

      <p
        className={cn(
          'mt-1 text-[10px]',
          resolved.nodeIds.length === 0 ? 'text-warn' : 'text-ink-faint',
        )}
      >
        Affects {describeScope(scope, resolved)}.
        {!resolved.isWhole && resolved.nodeIds.length > 0 && (
          <> The advance width is left unchanged.</>
        )}
      </p>
    </div>
  )
}
