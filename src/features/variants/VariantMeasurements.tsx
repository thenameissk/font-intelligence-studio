import { useMemo, useState } from 'react'
import type { FontDna } from '@/types/analysis'
import type { VerticalMetrics } from '@/types/font'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import {
  ALIGNMENT,
  compareGlyphs,
  overlayOffset,
  type Alignment,
  type Measurable,
  type MeasurementRow,
} from '@/engine/analysis/compareGlyphs'
import { buildMetricLines } from '@/features/glyph-editor/metricLines'
import { cn } from '@/utils/cn'

/**
 * What actually changes if this variant is adopted, in numbers.
 *
 * The annotated drawing above says where the two forms part company; this
 * says by how much. Both are needed to decide: a one-storey `a` that is 40
 * units narrower and 12 units lighter in the stem will not sit in the same
 * setting as the letter it replaces, and no diagram makes that visible.
 */
export function VariantMeasurements({
  current,
  variant,
  metrics,
  dna,
  currentLabel,
  variantLabel,
}: {
  current: Measurable
  variant: Measurable
  metrics: VerticalMetrics
  dna: FontDna | null
  currentLabel: string
  variantLabel: string
}) {
  const [alignment, setAlignment] = useState<Alignment>(ALIGNMENT.Origin)

  const references = useMemo(
    () =>
      buildMetricLines(metrics, dna)
        .map((line) => line.value)
        .filter((value) => value > 0),
    [metrics, dna],
  )

  const { rows } = useMemo(
    () => compareGlyphs(current, variant, metrics, references),
    [current, variant, metrics, references],
  )

  const differing = rows.filter((row) => row.delta !== null && !row.matched)

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <section>
        <h3 className="mb-2 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
          One on top of the other
        </h3>
        <Overlay
          current={current}
          variant={variant}
          metrics={metrics}
          references={references}
          alignment={alignment}
        />
        <div className="mt-1.5 flex items-center gap-1">
          {(
            [
              [ALIGNMENT.Origin, 'Origin', 'Both from their own origin, so the bearings show'],
              [ALIGNMENT.Left, 'Ink left', 'Left edges of the ink together'],
              [ALIGNMENT.Centre, 'Centre', 'Ink centred, to compare the shapes alone'],
            ] as const
          ).map(([value, label, title]) => (
            <button
              key={value}
              type="button"
              title={title}
              onClick={() => setAlignment(value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                alignment === value
                  ? 'bg-elevated text-ink'
                  : 'text-ink-faint hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
          Measured
        </h3>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-ink-muted">
              <th className="py-1 text-left font-medium">Measurement</th>
              <th className="py-1 text-right font-medium text-accent">
                {currentLabel}
              </th>
              <th className="py-1 text-right font-medium">{variantLabel}</th>
              <th className="py-1 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MeasurementLine key={row.id} row={row} />
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-ink-faint">
          {differing.length === 0
            ? 'Every measurement agrees; this is the same drawing under another name.'
            : `${differing.length} of ${rows.length} measurements change.`}
        </p>
      </section>
    </div>
  )
}

function MeasurementLine({ row }: { row: MeasurementRow }) {
  const format = (value: number | null): string =>
    value === null ? '—' : String(Math.round(value))

  return (
    <tr className="border-t border-line">
      <td className="py-1 text-ink-muted">{row.label}</td>
      <td className="py-1 text-right font-mono text-ink">{format(row.a)}</td>
      <td className="py-1 text-right font-mono text-ink">{format(row.b)}</td>
      <td
        className={cn(
          'py-1 text-right font-mono',
          row.delta === null || row.matched ? 'text-ink-faint' : 'text-warn',
        )}
      >
        {row.delta === null
          ? '—'
          : row.matched
            ? 'same'
            : `${row.delta > 0 ? '+' : ''}${Math.round(row.delta)}`}
      </td>
    </tr>
  )
}

function Overlay({
  current,
  variant,
  metrics,
  references,
  alignment,
}: {
  current: Measurable
  variant: Measurable
  metrics: VerticalMetrics
  references: readonly number[]
  alignment: Alignment
}) {
  const upm = metrics.unitsPerEm
  const dx = overlayOffset(current, variant, alignment)
  const currentPath = useMemo(
    () => outlineToSvgPathData(current.outline, 1),
    [current.outline],
  )
  const variantPath = useMemo(
    () => outlineToSvgPathData(variant.outline, 1),
    [variant.outline],
  )

  const width = Math.max(current.advanceWidth, variant.advanceWidth + dx, upm * 0.4)
  const top = -metrics.ascender
  const height = metrics.ascender - metrics.descender

  return (
    <div className="overflow-hidden rounded border border-line bg-input">
      <svg
        viewBox={`${-upm * 0.05} ${top} ${width + upm * 0.1} ${height}`}
        className="h-44 w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {[0, ...references].map((value) => (
          <line
            key={value}
            x1={-upm * 0.05}
            y1={-value}
            x2={width + upm * 0.05}
            y2={-value}
            className={value === 0 ? 'stroke-ink-faint' : 'stroke-line'}
            strokeWidth={upm * 0.003}
          />
        ))}
        <g transform="scale(1,-1)">
          <path d={variantPath} className="fill-ink" fillRule="nonzero" opacity={0.4} />
          <path
            d={currentPath}
            transform={`translate(${-dx} 0)`}
            className="fill-accent"
            fillRule="nonzero"
            opacity={0.55}
          />
        </g>
      </svg>
    </div>
  )
}
