import { useMemo, useState } from 'react'
import { Columns2, X } from 'lucide-react'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import { formatCodepoint } from '@/engine/parser/unicode'
import { IconButton } from '@/components/ui/Button'
import { useEditorStore } from '@/store/editorStore'
import { useFontStore } from '@/store/fontStore'
import { cn } from '@/utils/cn'

/**
 * Two glyphs from this font, side by side on shared metric lines.
 *
 * Consistency between related letters is judged by looking at them together,
 * not by reading their numbers one after the other. The comparison sits
 * alongside the editor so a change to the glyph being edited is visible
 * against its neighbour as it happens.
 */
export function CompareStrip({ parsed }: { parsed: ParsedFont }) {
  const edits = useFontStore((s) => s.edits)
  const selected = useEditorStore((s) => s.selectedGlyphs)
  const compareWith = useEditorStore((s) => s.compareWith)
  const setCompareWith = useEditorStore((s) => s.setCompareWith)
  const [query, setQuery] = useState('')

  const current = selected.length > 0 ? selected[selected.length - 1] : null

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (trimmed.length === 0) return []
    return parsed.index
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(trimmed) ||
          (entry.char !== null && entry.char.toLowerCase() === trimmed),
      )
      .slice(0, 8)
  }, [parsed.index, query])

  if (compareWith === null) {
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

  const a = current !== null ? resolveGlyph(parsed, edits, current) : null
  const b = resolveGlyph(parsed, edits, compareWith)

  return (
    <div className="flex items-stretch gap-2 border-t border-line px-2 py-2">
      {a && <ComparePane parsed={parsed} glyph={a} label="Editing" accent />}
      <ComparePane parsed={parsed} glyph={b} label="Comparing" />
      <IconButton label="Close comparison" onClick={() => setCompareWith(null)}>
        <X size={12} />
      </IconButton>
    </div>
  )
}

function ComparePane({
  parsed,
  glyph,
  label,
  accent = false,
}: {
  parsed: ParsedFont
  glyph: ReturnType<typeof resolveGlyph>
  label: string
  accent?: boolean
}) {
  const metrics = parsed.verticalMetrics
  const path = useMemo(
    () => outlineToSvgPathData(glyph.outline, 1),
    [glyph.outline],
  )

  const upm = metrics.unitsPerEm
  const width = Math.max(glyph.advanceWidth, upm * 0.4)
  const top = -metrics.ascender
  const height = metrics.ascender - metrics.descender

  const rule = (value: number): number => -value

  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1">
      <figcaption className="flex items-baseline gap-1.5 truncate">
        <span
          className={cn(
            'text-[10px] font-medium',
            accent ? 'text-accent' : 'text-ink-muted',
          )}
        >
          {label}
        </span>
        <span className="truncate text-[10px] text-ink">{glyph.name}</span>
        <span className="font-mono text-[9px] text-ink-faint">
          {formatCodepoint(glyph.unicode)} · {Math.round(glyph.advanceWidth)}u
        </span>
      </figcaption>
      <div className="h-24 overflow-hidden rounded border border-line bg-input">
        <svg
          viewBox={`${-upm * 0.05} ${top} ${width + upm * 0.1} ${height}`}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Shared rules, so the two are judged against the same measure. */}
          {[0, metrics.xHeight ?? upm * 0.5, metrics.capHeight ?? upm * 0.7].map(
            (value) => (
              <line
                key={value}
                x1={-upm * 0.05}
                y1={rule(value)}
                x2={width + upm * 0.05}
                y2={rule(value)}
                className="stroke-line"
                strokeWidth={upm * 0.004}
              />
            ),
          )}
          <line
            x1={glyph.advanceWidth}
            y1={top}
            x2={glyph.advanceWidth}
            y2={rule(metrics.descender)}
            className="stroke-line"
            strokeWidth={upm * 0.003}
            strokeDasharray={`${upm * 0.02} ${upm * 0.02}`}
          />
          <g transform="scale(1,-1)">
            <path
              d={path}
              className={accent ? 'fill-accent' : 'fill-ink'}
              fillRule="nonzero"
            />
          </g>
        </svg>
      </div>
    </figure>
  )
}
