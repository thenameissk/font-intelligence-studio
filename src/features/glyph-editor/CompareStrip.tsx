import { useMemo, useState } from 'react'
import { Columns2, Layers, Table2, X } from 'lucide-react'
import type { FontDna } from '@/types/analysis'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import { formatCodepoint } from '@/engine/parser/unicode'
import {
  ALIGNMENT,
  compareGlyphs,
  overlayOffset,
  type Alignment,
  type MeasurementRow,
} from '@/engine/analysis/compareGlyphs'
import { IconButton } from '@/components/ui/Button'
import { useEditorStore } from '@/store/editorStore'
import { useFontStore } from '@/store/fontStore'
import { cn } from '@/utils/cn'
import { buildMetricLines } from './metricLines'

/**
 * Two glyphs from this font, measured against each other.
 *
 * Consistency is judged comparatively: a letter is never too wide in the
 * abstract, only wider than the letters beside it. Two pictures show that
 * something differs without ever saying by how much, so the numbers that
 * actually settle it sit next to them -- and the outlines can be laid on top
 * of one another, which is the one view that makes a stem mismatch obvious
 * at a glance.
 */

const MODE = { Side: 'side', Overlay: 'overlay', Data: 'data' } as const
type Mode = (typeof MODE)[keyof typeof MODE]

export function CompareStrip({
  parsed,
  dna,
}: {
  parsed: ParsedFont
  dna: FontDna | null
}) {
  const edits = useFontStore((s) => s.edits)
  const selected = useEditorStore((s) => s.selectedGlyphs)
  const compareWith = useEditorStore((s) => s.compareWith)
  const setCompareWith = useEditorStore((s) => s.setCompareWith)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>(MODE.Side)
  const [alignment, setAlignment] = useState<Alignment>(ALIGNMENT.Origin)

  const current = selected.length > 0 ? selected[selected.length - 1] : null

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (trimmed.length === 0) return []

    // Typing `n` means the letter n, not the twenty glyph names that happen
    // to contain an n. Rank the exact character first, then names that start
    // with the query, and only then names that merely contain it -- otherwise
    // the letter you asked for falls off the end of the list.
    const rank = (entry: (typeof parsed.index)[number]): number => {
      const name = entry.name.toLowerCase()
      if (entry.char !== null && entry.char.toLowerCase() === trimmed) return 0
      if (name === trimmed) return 1
      if (name.startsWith(trimmed)) return 2
      return 3
    }

    return parsed.index
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(trimmed) ||
          (entry.char !== null && entry.char.toLowerCase() === trimmed),
      )
      .map((entry) => ({ entry, rank: rank(entry) }))
      .sort((a, b) => a.rank - b.rank || a.entry.index - b.entry.index)
      .slice(0, 8)
      .map((match) => match.entry)
  }, [parsed.index, query])

  // The same lines the canvas draws, which prefer measured values over the
  // OS/2 fields that many fonts leave empty.
  const references = useMemo(
    () =>
      buildMetricLines(parsed.verticalMetrics, dna)
        .map((line) => line.value)
        .filter((value) => value > 0),
    [parsed.verticalMetrics, dna],
  )

  const a = current !== null ? resolveGlyph(parsed, edits, current) : null
  const b = compareWith !== null ? resolveGlyph(parsed, edits, compareWith) : null

  const comparison = useMemo(
    () => (a && b ? compareGlyphs(a, b, parsed.verticalMetrics, references) : null),
    [a, b, parsed.verticalMetrics, references],
  )

  if (compareWith === null || !b) {
    return (
      <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
        <Columns2 size={11} className="shrink-0 text-ink-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Compare with another glyph…"
          className="h-6 min-w-0 flex-1 rounded border border-line bg-input px-1.5 text-2xs text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        {matches.map((entry) => (
          <button
            key={entry.index}
            type="button"
            onClick={() => {
              setCompareWith(entry.index)
              setQuery('')
            }}
            className="shrink-0 rounded border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-ink hover:bg-hover"
          >
            {entry.char ?? entry.name}
          </button>
        ))}
      </div>
    )
  }

  // A measurement that does not apply to one of the letters is not a
  // disagreement between them, so it is not counted as one.
  const differing =
    comparison?.rows.filter((row) => row.delta !== null && !row.matched).length ?? 0

  return (
    <div className="flex flex-col gap-2 border-t border-line px-2 py-2">
      <div className="flex items-center gap-1.5">
        <ModeButton icon={<Columns2 size={11} />} label="Side by side" active={mode === MODE.Side} onClick={() => setMode(MODE.Side)} />
        <ModeButton icon={<Layers size={11} />} label="Overlay" active={mode === MODE.Overlay} onClick={() => setMode(MODE.Overlay)} />
        <ModeButton icon={<Table2 size={11} />} label="Measurements" active={mode === MODE.Data} onClick={() => setMode(MODE.Data)} />

        {mode === MODE.Overlay && (
          <div className="ml-1 flex items-center gap-1">
            {(
              [
                [ALIGNMENT.Origin, 'Origin', 'Both drawn from their own origin, so the side bearings show'],
                [ALIGNMENT.Left, 'Ink left', 'Left edges of the ink brought together'],
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
        )}

        <span className="ml-auto text-[10px] text-ink-faint">
          {differing === 0
            ? 'Every measurement agrees'
            : `${differing} measurement${differing === 1 ? '' : 's'} differ`}
        </span>
        <IconButton label="Close comparison" onClick={() => setCompareWith(null)}>
          <X size={12} />
        </IconButton>
      </div>

      {mode === MODE.Side && (
        <div className="flex items-stretch gap-2">
          {a && <ComparePane parsed={parsed} glyph={a} label="Editing" references={references} accent />}
          <ComparePane parsed={parsed} glyph={b} label="Comparing" references={references} />
        </div>
      )}

      {mode === MODE.Overlay && a && (
        <OverlayPane parsed={parsed} a={a} b={b} alignment={alignment} references={references} />
      )}

      {mode === MODE.Data && comparison && a && (
        <MeasurementTable rows={comparison.rows} aName={a.name} bName={b.name} />
      )}
    </div>
  )
}

function ModeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
        active ? 'bg-elevated text-ink' : 'text-ink-faint hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function GlyphCaption({
  glyph,
  label,
  accent,
}: {
  glyph: ReturnType<typeof resolveGlyph>
  label: string
  accent: boolean
}) {
  return (
    <figcaption className="flex items-baseline gap-1.5 truncate">
      <span className={cn('text-[10px] font-medium', accent ? 'text-accent' : 'text-ink-muted')}>
        {label}
      </span>
      <span className="truncate text-[10px] text-ink">{glyph.name}</span>
      <span className="font-mono text-[9px] text-ink-faint">
        {formatCodepoint(glyph.unicode)} · {Math.round(glyph.advanceWidth)}u
      </span>
    </figcaption>
  )
}

function Rules({
  references,
  from,
  to,
  upm,
}: {
  references: readonly number[]
  from: number
  to: number
  upm: number
}) {
  return (
    <>
      {references.map((value) => (
        <line
          key={value}
          x1={from}
          y1={-value}
          x2={to}
          y2={-value}
          className={value === 0 ? 'stroke-ink-faint' : 'stroke-line'}
          strokeWidth={upm * 0.004}
        />
      ))}
    </>
  )
}

function ComparePane({
  parsed,
  glyph,
  label,
  references,
  accent = false,
}: {
  parsed: ParsedFont
  glyph: ReturnType<typeof resolveGlyph>
  label: string
  references: readonly number[]
  accent?: boolean
}) {
  const metrics = parsed.verticalMetrics
  const path = useMemo(() => outlineToSvgPathData(glyph.outline, 1), [glyph.outline])

  const upm = metrics.unitsPerEm
  const width = Math.max(glyph.advanceWidth, upm * 0.4)
  const top = -metrics.ascender
  const height = metrics.ascender - metrics.descender

  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1">
      <GlyphCaption glyph={glyph} label={label} accent={accent} />
      <div className="h-24 overflow-hidden rounded border border-line bg-input">
        <svg
          viewBox={`${-upm * 0.05} ${top} ${width + upm * 0.1} ${height}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <Rules references={[0, ...references]} from={-upm * 0.05} to={width + upm * 0.05} upm={upm} />
          <line
            x1={glyph.advanceWidth}
            y1={top}
            x2={glyph.advanceWidth}
            y2={-metrics.descender}
            className="stroke-line"
            strokeWidth={upm * 0.003}
            strokeDasharray={`${upm * 0.02} ${upm * 0.02}`}
          />
          <g transform="scale(1,-1)">
            <path d={path} className={accent ? 'fill-accent' : 'fill-ink'} fillRule="nonzero" />
          </g>
        </svg>
      </div>
    </figure>
  )
}

/**
 * The two outlines on one set of axes.
 *
 * Both are drawn as translucent fills rather than as one fill and one
 * wireframe: where they agree the colours combine, so disagreement is what
 * catches the eye instead of the viewer having to trace an outline by hand.
 */
function OverlayPane({
  parsed,
  a,
  b,
  alignment,
  references,
}: {
  parsed: ParsedFont
  a: ReturnType<typeof resolveGlyph>
  b: ReturnType<typeof resolveGlyph>
  alignment: Alignment
  references: readonly number[]
}) {
  const metrics = parsed.verticalMetrics
  const upm = metrics.unitsPerEm
  const pathA = useMemo(() => outlineToSvgPathData(a.outline, 1), [a.outline])
  const pathB = useMemo(() => outlineToSvgPathData(b.outline, 1), [b.outline])
  const dx = overlayOffset(a, b, alignment)

  const width = Math.max(a.advanceWidth, b.advanceWidth + dx, upm * 0.4)
  const top = -metrics.ascender
  const height = metrics.ascender - metrics.descender

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline gap-2 text-[10px]">
        <span className="text-accent">{a.name}</span>
        <span className="text-ink-faint">over</span>
        <span className="text-ink">{b.name}</span>
        {dx !== 0 && (
          <span className="font-mono text-[9px] text-ink-faint">
            shifted {Math.round(dx)}u to register
          </span>
        )}
      </figcaption>
      <div className="h-32 overflow-hidden rounded border border-line bg-input">
        <svg
          viewBox={`${-upm * 0.05} ${top} ${width + upm * 0.1} ${height}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <Rules references={[0, ...references]} from={-upm * 0.05} to={width + upm * 0.05} upm={upm} />
          <g transform="scale(1,-1)">
            <path d={pathB} className="fill-ink" fillRule="nonzero" opacity={0.45} />
            <path
              d={pathA}
              transform={`translate(${-dx} 0)`}
              className="fill-accent"
              fillRule="nonzero"
              opacity={0.55}
            />
          </g>
        </svg>
      </div>
    </figure>
  )
}

function formatValue(value: number | null, unit: MeasurementRow['unit']): string {
  if (value === null) return '—'
  if (unit === 'count') return String(value)
  return `${Math.round(value)}`
}

function MeasurementTable({
  rows,
  aName,
  bName,
}: {
  rows: readonly MeasurementRow[]
  aName: string
  bName: string
}) {
  return (
    <div className="max-h-40 overflow-y-auto rounded border border-line">
      <table className="w-full border-collapse text-[10px]">
        <thead className="sticky top-0 bg-elevated">
          <tr className="text-ink-muted">
            <th className="px-2 py-1 text-left font-medium">Measurement</th>
            <th className="px-2 py-1 text-right font-medium text-accent">{aName}</th>
            <th className="px-2 py-1 text-right font-medium">{bName}</th>
            <th className="px-2 py-1 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="px-2 py-1 text-ink-muted">{row.label}</td>
              <td className="px-2 py-1 text-right font-mono text-ink">
                {formatValue(row.a, row.unit)}
              </td>
              <td className="px-2 py-1 text-right font-mono text-ink">
                {formatValue(row.b, row.unit)}
              </td>
              <td
                className={cn(
                  'px-2 py-1 text-right font-mono',
                  row.delta === null || row.matched ? 'text-ink-faint' : 'text-warn',
                )}
              >
                {row.delta === null
                  ? '—'
                  : row.matched
                    ? 'matches'
                    : `${row.delta > 0 ? '+' : ''}${Math.round(row.delta)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
