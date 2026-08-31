import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { KernPair } from '@/engine/typography/kerning'
import {
  buildPair,
  collectPairs,
  effectiveKerning,
  pairKey,
} from '@/engine/typography/kerning'
import { resolveOutline } from '@/engine/parser/glyphAccess'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import { resolveAdvanceWidth } from '@/engine/parser/glyphAccess'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { useFontStore } from '@/store/fontStore'
import { useHistoryStore } from '@/store/historyStore'
import { cn } from '@/utils/cn'
import { formatSigned } from '@/utils/format'

export function KerningView() {
  const parsed = useFontStore((s) => s.parsed)
  const kerningEdits = useFontStore((s) => s.kerningEdits)

  const [query, setQuery] = useState('')
  const [onlyKerned, setOnlyKerned] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [size, setSize] = useState(150)
  const deferredQuery = useDeferredValue(query)

  const pairs = useMemo(() => {
    if (!parsed) return []
    const all = collectPairs(parsed, kerningEdits, { onlyKerned })
    const typed = [...deferredQuery]
    if (typed.length === 2) {
      const custom = buildPair(parsed, kerningEdits, typed[0], typed[1])
      if (custom && !all.some((p) => p.left === custom.left && p.right === custom.right)) {
        return [custom, ...all]
      }
    }
    if (deferredQuery.length === 0) return all
    return all.filter((pair) =>
      `${pair.leftChar}${pair.rightChar}`.includes(deferredQuery),
    )
  }, [parsed, kerningEdits, onlyKerned, deferredQuery])

  const selected =
    pairs.find((pair) => pairKey(pair.left, pair.right) === selectedKey) ??
    pairs[0] ??
    null

  if (!parsed) return null

  // A GPOS table wins over `kern` regardless of which features it declares.
  const hasGposKerning = parsed.metadata.tables.some(
    (table) => table.tag === 'GPOS',
  )

  return (
    <div className="flex h-full overflow-hidden bg-base">
      <div className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="shrink-0 space-y-2 border-b border-line p-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a pair, e.g. AV"
            maxLength={2}
            className="h-7 w-full rounded-md border border-line bg-input px-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <label className="flex items-center gap-1.5 text-2xs text-ink-muted">
            <input
              type="checkbox"
              checked={onlyKerned}
              onChange={(event) => setOnlyKerned(event.target.checked)}
              className="accent-[var(--fis-accent)]"
            />
            Only pairs with kerning
          </label>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {pairs.map((pair) => {
            const key = pairKey(pair.left, pair.right)
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1 text-left',
                    selected && key === pairKey(selected.left, selected.right)
                      ? 'bg-accent-soft text-accent'
                      : 'hover:bg-hover',
                  )}
                >
                  <span className="w-10 font-mono text-xs">
                    {pair.leftChar}
                    {pair.rightChar}
                  </span>
                  <span
                    className={cn(
                      'flex-1 font-mono text-2xs tabular',
                      pair.current === 0 ? 'text-ink-faint' : 'text-ink-muted',
                    )}
                  >
                    {formatSigned(pair.current)}
                  </span>
                  {pair.modified && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </button>
              </li>
            )
          })}
          {pairs.length === 0 && (
            <li className="px-3 py-6 text-center text-2xs text-ink-faint">
              No pairs match.
            </li>
          )}
        </ul>

        <div className="shrink-0 border-t border-line px-2 py-1 font-mono text-2xs text-ink-faint">
          {pairs.length} pairs · {Object.keys(kerningEdits).length} edited
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <PairEditor
            parsed={parsed}
            pair={selected}
            size={size}
            onSize={setSize}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
            Select a pair to kern it.
          </div>
        )}

        {hasGposKerning && (
          <p className="shrink-0 border-t border-line px-4 py-2 text-2xs text-warn">
            This font kerns through GPOS. Changes are applied in the preview
            and written to a legacy <span className="font-mono">kern</span>{' '}
            table on export; renderers that prefer GPOS will keep using the
            original values. Rebuilding GPOS is not supported.
          </p>
        )}
      </div>
    </div>
  )
}

function PairEditor({
  parsed,
  pair,
  size,
  onSize,
}: {
  parsed: ParsedFont
  pair: KernPair
  size: number
  onSize: (value: number) => void
}) {
  const edits = useFontStore((s) => s.edits)
  const kerningEdits = useFontStore((s) => s.kerningEdits)
  const history = useHistoryStore
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null)

  const value = effectiveKerning(parsed, kerningEdits, pair.left, pair.right)
  const upm = parsed.verticalMetrics.unitsPerEm
  const scale = size / upm

  const leftPath = outlineToSvgPathData(
    resolveOutline(parsed, edits, pair.left),
    1,
  )
  const rightPath = outlineToSvgPathData(
    resolveOutline(parsed, edits, pair.right),
    1,
  )
  const leftAdvance = resolveAdvanceWidth(parsed, edits, pair.left)
  const rightAdvance = resolveAdvanceWidth(parsed, edits, pair.right)

  const totalUnits = leftAdvance + value + rightAdvance
  const setValue = (next: number): void => {
    history
      .getState()
      .commit(`Kern ${pair.leftChar}${pair.rightChar}`, {}, {
        [pairKey(pair.left, pair.right)]: Math.round(next),
      })
  }

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="font-mono text-xs text-ink">
          {pair.leftChar}
          {pair.rightChar}
        </span>
        <NumberInput
          ariaLabel="Kerning value"
          value={value}
          step={1}
          onChange={setValue}
          suffix="u"
          className="w-24"
        />
        <span className="font-mono text-2xs text-ink-faint">
          original {formatSigned(pair.original)}
        </span>
        {pair.modified && (
          <Button
            size="sm"
            onClick={() =>
              history
                .getState()
                .commit(`Reset kern ${pair.leftChar}${pair.rightChar}`, {}, {
                  [pairKey(pair.left, pair.right)]: null,
                })
            }
          >
            <RotateCcw size={11} />
            Reset
          </Button>
        )}
        <span className="flex-1" />
        <NumberInput
          ariaLabel="Preview size"
          value={size}
          min={40}
          max={480}
          step={10}
          onChange={onSize}
          suffix="px"
          className="w-20"
        />
      </div>

      <div
        className="flex min-h-0 flex-1 cursor-ew-resize items-center justify-center overflow-hidden select-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { startX: event.clientX, startValue: value }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag) return
          const deltaPixels = event.clientX - drag.startX
          setValue(drag.startValue + deltaPixels / scale)
        }}
        onPointerUp={(event) => {
          dragRef.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        title="Drag left or right to kern this pair"
      >
        <svg
          width={Math.max(1, totalUnits * scale)}
          height={size * 1.4}
          viewBox={`0 ${-parsed.verticalMetrics.ascender} ${Math.max(1, totalUnits)} ${upm * 1.4}`}
          className="overflow-visible text-ink"
        >
          {/* Baseline and the sidebearing edges either side of the join. */}
          <line
            x1={0}
            y1={0}
            x2={totalUnits}
            y2={0}
            className="stroke-guide"
            strokeWidth={upm * 0.004}
          />
          <line
            x1={leftAdvance + value}
            y1={-parsed.verticalMetrics.ascender}
            x2={leftAdvance + value}
            y2={-parsed.verticalMetrics.descender}
            className="stroke-accent"
            strokeWidth={upm * 0.004}
            strokeDasharray={`${upm * 0.02} ${upm * 0.02}`}
          />
          <g transform="scale(1,-1)">
            <path d={leftPath} fill="currentColor" fillRule="nonzero" />
            <path
              d={rightPath}
              fill="currentColor"
              fillRule="nonzero"
              transform={`translate(${leftAdvance + value} 0)`}
            />
          </g>
        </svg>
      </div>

      <div className="shrink-0 border-t border-line px-4 py-2">
        <p className="font-mono text-2xs text-ink-faint">
          drag the preview to kern · {pair.leftChar} advance {leftAdvance} ·
          kern {formatSigned(value)} · {pair.rightChar} advance {rightAdvance}
        </p>
      </div>
    </>
  )
}
