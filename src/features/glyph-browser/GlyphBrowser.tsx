import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type GlyphCategory,
} from '@/types/font'
import { RECOMMENDED_CODEPOINTS, codepointToDisplayChar } from '@/engine/parser/unicode'
import { useFontStore } from '@/store/fontStore'
import { useEditorStore } from '@/store/editorStore'
import { cn } from '@/utils/cn'
import { countByCategory, filterGlyphs } from './glyphSearch'
import { CELL_HEIGHT, CELL_WIDTH, GlyphCell, MissingCell } from './GlyphCell'
import { VirtualGrid } from './VirtualGrid'

type Filter = GlyphCategory | 'all' | 'missing' | 'modified'

export function GlyphBrowser() {
  const parsed = useFontStore((s) => s.parsed)
  const edits = useFontStore((s) => s.edits)
  const selectedGlyphs = useEditorStore((s) => s.selectedGlyphs)
  const selectGlyph = useEditorStore((s) => s.selectGlyph)

  const [rawQuery, setRawQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const query = useDeferredValue(rawQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(
    () => (parsed ? countByCategory(parsed.index) : new Map()),
    [parsed],
  )

  const missing = useMemo(() => {
    if (!parsed) return []
    return RECOMMENDED_CODEPOINTS.filter(
      (codepoint) => !parsed.cmap.has(codepoint),
    ).map((codepoint) => ({
      codepoint,
      char: codepointToDisplayChar(codepoint),
    }))
  }, [parsed])

  const entries = useMemo(() => {
    if (!parsed) return []
    if (filter === 'missing') return []
    const base =
      filter === 'modified'
        ? parsed.index.filter((entry) => edits[entry.index] !== undefined)
        : parsed.index
    return filterGlyphs(base, {
      query,
      category: filter === 'all' || filter === 'modified' ? 'all' : filter,
      hideEmpty: false,
    })
  }, [parsed, query, filter, edits])

  const selectedSet = useMemo(() => new Set(selectedGlyphs), [selectedGlyphs])
  const primary = selectedGlyphs[selectedGlyphs.length - 1] ?? null
  const scrollToIndex = useMemo(() => {
    if (primary === null) return null
    const position = entries.findIndex((entry) => entry.index === primary)
    return position >= 0 ? position : null
  }, [entries, primary])

  if (!parsed) return null

  const modifiedCount = Object.keys(edits).length
  const showingMissing = filter === 'missing'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line p-2">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint"
          />
          <input
            ref={inputRef}
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRawQuery('')
              event.stopPropagation()
            }}
            placeholder="Search name, character, U+…"
            className="h-7 w-full rounded-md border border-line bg-input pr-7 pl-6.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
          {rawQuery.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setRawQuery('')
                inputRef.current?.focus()
              }}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:bg-hover hover:text-ink"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          <Chip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            count={parsed.index.length}
          >
            All
          </Chip>
          {modifiedCount > 0 && (
            <Chip
              active={filter === 'modified'}
              onClick={() => setFilter('modified')}
              count={modifiedCount}
              tone="accent"
            >
              Edited
            </Chip>
          )}
          {missing.length > 0 && (
            <Chip
              active={filter === 'missing'}
              onClick={() => setFilter('missing')}
              count={missing.length}
              tone="warn"
            >
              Missing
            </Chip>
          )}
          {CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0).map(
            (category) => (
              <Chip
                key={category}
                active={filter === category}
                onClick={() => setFilter(category)}
                count={counts.get(category) ?? 0}
              >
                {CATEGORY_LABELS[category]}
              </Chip>
            ),
          )}
        </div>
      </div>

      {showingMissing ? (
        <VirtualGrid
          itemCount={missing.length}
          cellWidth={CELL_WIDTH}
          cellHeight={CELL_HEIGHT}
          renderItem={(position) => (
            <MissingCell
              codepoint={missing[position].codepoint}
              char={missing[position].char}
            />
          )}
        />
      ) : (
        <VirtualGrid
          itemCount={entries.length}
          cellWidth={CELL_WIDTH}
          cellHeight={CELL_HEIGHT}
          scrollToIndex={scrollToIndex}
          empty={
            <p className="px-4 py-8 text-center text-xs text-ink-faint">
              No glyphs match “{query}”.
            </p>
          }
          renderItem={(position) => {
            const entry = entries[position]
            return (
              <GlyphCell
                parsed={parsed}
                entry={entry}
                edit={edits[entry.index]}
                selected={selectedSet.has(entry.index)}
                onSelect={(index, event) =>
                  selectGlyph(
                    index,
                    event.shiftKey
                      ? 'range'
                      : event.metaKey || event.ctrlKey
                        ? 'toggle'
                        : 'replace',
                  )
                }
              />
            )
          }}
        />
      )}

      <div className="flex h-6 shrink-0 items-center justify-between border-t border-line px-2 font-mono text-2xs text-ink-faint">
        <span>
          {showingMissing
            ? `${missing.length} recommended glyphs missing`
            : `${entries.length} of ${parsed.index.length}`}
        </span>
        {selectedGlyphs.length > 1 && (
          <span className="text-accent">{selectedGlyphs.length} selected</span>
        )}
      </div>
    </div>
  )
}

function Chip({
  children,
  active,
  count,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode
  active: boolean
  count: number
  onClick: () => void
  tone?: 'default' | 'accent' | 'warn'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-elevated text-ink-muted hover:bg-hover hover:text-ink',
      )}
    >
      <span
        className={cn(
          !active && tone === 'warn' && 'text-warn',
          !active && tone === 'accent' && 'text-accent',
        )}
      >
        {children}
      </span>
      <span className="tabular opacity-60">{count}</span>
    </button>
  )
}
