import type { Classification, Confidence, FontDna, Metric } from '@/types/analysis'
import { formatUnits } from '@/utils/format'
import { cn } from '@/utils/cn'

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  measured: 'Measured from outlines',
  declared: 'Declared in the font',
  estimated: 'Estimated — heuristic',
  unavailable: 'Not available',
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  measured: 'bg-ok',
  declared: 'bg-accent',
  estimated: 'bg-warn',
  unavailable: 'bg-ink-faint',
}

/**
 * The Font DNA summary.
 *
 * Every row carries a marker for how the value was obtained, because half of
 * these are heuristics and presenting them as facts would be misleading.
 */
export function FontDnaPanel({ dna }: { dna: FontDna }) {
  const ratio = (metric: Metric): string =>
    metric.value === null ? '—' : metric.value.toFixed(3)

  return (
    <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
      <div>
        <SectionTitle>Font DNA</SectionTitle>
        <dl className="mt-2">
          <DnaRow label="Weight" classification={dna.weight} />
          <DnaRow label="Width" classification={dna.width} />
          <DnaRow label="Contrast" classification={dna.contrastLabel} />
          <DnaRow label="Geometry" classification={dna.geometry} />
          <DnaRow label="Serifs" classification={dna.serifs} />
          <DnaRow label="Terminals" classification={dna.terminals} />
          <DnaRow label="Corners" classification={dna.corners} />
          <DnaRow label="Curvature" classification={dna.curvature} />
          <MetricRow
            label="x-height"
            metric={dna.xHeightRatio}
            format={ratio}
            hint="of the em"
          />
          <MetricRow
            label="Cap height"
            metric={dna.capHeightRatio}
            format={ratio}
            hint="of the em"
          />
          <MetricRow
            label="Slant"
            metric={dna.slant}
            format={(m) => (m.value === null ? '—' : `${formatUnits(m.value, 1)}°`)}
          />
        </dl>
      </div>

      <div>
        <SectionTitle>Measured metrics</SectionTitle>
        <dl className="mt-2">
          <MetricRow label="x-height" metric={dna.xHeight} unit />
          <MetricRow label="Cap height" metric={dna.capHeight} unit />
          <MetricRow label="Ascender" metric={dna.ascender} unit />
          <MetricRow label="Descender" metric={dna.descender} unit />
          <MetricRow label="Cap overshoot" metric={dna.capOvershoot} unit />
          <MetricRow label="x-height overshoot" metric={dna.xOvershoot} unit />
          <MetricRow label="Vertical stem" metric={dna.verticalStem.width} unit />
          <MetricRow label="Horizontal stroke" metric={dna.horizontalStroke} unit />
          <MetricRow
            label="Stress axis"
            metric={dna.stressAngle}
            format={(m) => (m.value === null ? '—' : `${formatUnits(m.value, 0)}°`)}
          />
          <MetricRow label="Avg advance width" metric={dna.averageAdvanceWidth} unit />
          <MetricRow label="Avg left bearing" metric={dna.averageLeftSideBearing} unit />
          <MetricRow label="Avg right bearing" metric={dna.averageRightSideBearing} unit />
          <MetricRow label="Avg glyph height" metric={dna.averageGlyphHeight} unit />
        </dl>
      </div>

      {dna.verticalStem.samples.length > 0 && (
        <div className="md:col-span-2">
          <SectionTitle>Stem samples</SectionTitle>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {dna.verticalStem.samples.map((sample) => (
              <span key={sample.glyph} className="text-xs text-ink-muted">
                <span className="font-mono text-ink">{sample.glyph}</span>{' '}
                {formatUnits(sample.width)}
              </span>
            ))}
          </div>
        </div>
      )}

      {dna.widthDistribution.length > 1 && (
        <div className="md:col-span-2">
          <SectionTitle>Advance width distribution</SectionTitle>
          <WidthHistogram dna={dna} />
        </div>
      )}

      {dna.missingKeyGlyphs.length > 0 && (
        <p className="text-2xs text-warn md:col-span-2">
          Some reference glyphs are missing ({dna.missingKeyGlyphs.join(', ')}),
          so parts of this profile fall back to declared values.
        </p>
      )}

      <Legend />
    </div>
  )
}

function WidthHistogram({ dna }: { dna: FontDna }) {
  const max = Math.max(...dna.widthDistribution.map((b) => b.count), 1)
  return (
    <div className="mt-3">
      <div className="flex h-20 items-end gap-px">
        {dna.widthDistribution.map((bucket) => (
          <div
            key={bucket.width}
            title={`${bucket.count} glyphs near ${bucket.width} units`}
            className="min-w-0 flex-1 rounded-t-sm bg-accent/70 hover:bg-accent"
            style={{ height: `${Math.max(2, (bucket.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-2xs text-ink-faint">
        <span>{dna.widthDistribution[0].width}</span>
        <span>units per glyph</span>
        <span>
          {dna.widthDistribution[dna.widthDistribution.length - 1].width}
        </span>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xs font-semibold tracking-wide text-ink-muted uppercase">
      {children}
    </h2>
  )
}

function DnaRow({
  label,
  classification,
}: {
  label: string
  classification: Classification
}) {
  return (
    <Row
      label={label}
      confidence={classification.confidence}
      basis={classification.basis}
    >
      {classification.label}
    </Row>
  )
}

function MetricRow({
  label,
  metric,
  unit = false,
  hint,
  format,
}: {
  label: string
  metric: Metric
  unit?: boolean
  hint?: string
  format?: (metric: Metric) => string
}) {
  const text = format
    ? format(metric)
    : metric.value === null
      ? '—'
      : formatUnits(metric.value)
  return (
    <Row label={label} confidence={metric.confidence} basis={metric.basis}>
      <span className="font-mono tabular">{text}</span>
      {unit && metric.value !== null && (
        <span className="ml-1 text-ink-faint">units</span>
      )}
      {hint && <span className="ml-1 text-ink-faint">{hint}</span>}
    </Row>
  )
}

function Row({
  label,
  confidence,
  basis,
  children,
}: {
  label: string
  confidence: Confidence
  basis: string
  children: React.ReactNode
}) {
  return (
    <div
      className="flex items-baseline gap-2 border-b border-line/60 py-1 last:border-b-0"
      title={`${CONFIDENCE_LABEL[confidence]} — ${basis}`}
    >
      <dt className="w-36 shrink-0 text-xs text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          confidence === 'unavailable' ? 'text-ink-faint' : 'text-ink',
        )}
      >
        {children}
      </dd>
      <span
        aria-label={CONFIDENCE_LABEL[confidence]}
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          CONFIDENCE_STYLE[confidence],
        )}
      />
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 md:col-span-2">
      {(['measured', 'declared', 'estimated', 'unavailable'] as const).map(
        (confidence) => (
          <span
            key={confidence}
            className="flex items-center gap-1.5 text-2xs text-ink-faint"
          >
            <span
              className={cn('h-1.5 w-1.5 rounded-full', CONFIDENCE_STYLE[confidence])}
            />
            {CONFIDENCE_LABEL[confidence]}
          </span>
        ),
      )}
    </div>
  )
}
