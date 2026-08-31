import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import type { GlyphIndexEntry } from '@/types/font'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { formatCodepoint } from '@/engine/parser/unicode'
import { filterGlyphs } from '@/features/glyph-browser/glyphSearch'
import { GlyphPreview } from '@/components/GlyphPreview'
import { useEditorStore } from '@/store/editorStore'
import { useFontStore } from '@/store/fontStore'
import { useUiStore, WORKSPACE } from '@/store/uiStore'
import { cn } from '@/utils/cn'
import { buildCommands, type Command } from './commands'

type Row =
  | { kind: 'command'; command: Command }
  | { kind: 'glyph'; entry: GlyphIndexEntry }

/**
 * The command palette.
 *
 * It searches commands and glyphs at once, because "open the ampersand" and
 * "round the corners" are the same kind of intent from the keyboard.
 */
export function CommandMenu() {
  const open = useUiStore((s) => s.commandMenuOpen)
  // Mounting only while open means the query and highlight start fresh
  // every time, with no effect needed to reset them.
  return open ? <Palette /> : null
}

function Palette() {
  const setOpen = useUiStore((s) => s.setCommandMenuOpen)
  const parsed = useFontStore((s) => s.parsed)
  const edits = useFontStore((s) => s.edits)
  const selectGlyph = useEditorStore((s) => s.selectGlyph)
  const setWorkspace = useUiStore((s) => s.setWorkspace)

  const [query, setQuery] = useState('')
  const [activeIndex, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const commands = useMemo(
    () =>
      buildCommands((indices) =>
        parsed ? indices.map((index) => resolveGlyph(parsed, edits, index)) : [],
      ),
    [parsed, edits],
  )

  const rows = useMemo((): Row[] => {
    const trimmed = query.trim().toLowerCase()
    const available = commands.filter((command) => command.available?.() ?? true)
    const matching = available.filter(
      (command) =>
        trimmed.length === 0 ||
        command.title.toLowerCase().includes(trimmed) ||
        command.group.toLowerCase().includes(trimmed),
    )

    const glyphRows: Row[] =
      parsed && trimmed.length > 0
        ? filterGlyphs(parsed.index, {
            query: query.trim(),
            category: 'all',
            hideEmpty: false,
          })
            .slice(0, 8)
            .map((entry) => ({ kind: 'glyph', entry }))
        : []

    return [
      ...matching.map((command): Row => ({ kind: 'command', command })),
      ...glyphRows,
    ]
  }, [commands, query, parsed])

  // Clamped during render rather than corrected afterwards, so the list can
  // shrink under the highlight without a second render pass.
  const active = Math.min(activeIndex, Math.max(0, rows.length - 1))

  useEffect(() => {
    const element = listRef.current?.children[active] as HTMLElement | undefined
    element?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (row: Row): void => {
    if (row.kind === 'command') {
      row.command.run()
    } else {
      selectGlyph(row.entry.index)
      setWorkspace(WORKSPACE.Glyphs)
    }
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-base/60 p-8 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="mt-[10vh] w-full max-w-lg overflow-hidden rounded-lg border border-line bg-elevated shadow-xl"
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <Search size={14} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((current) => Math.min(rows.length - 1, current + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((current) => Math.max(0, current - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const row = rows[active]
                if (row) choose(row)
              }
            }}
            placeholder="Search commands and glyphs…"
            className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="shrink-0 rounded border border-line px-1 font-mono text-[10px] text-ink-faint">
            esc
          </kbd>
        </div>

        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-ink-faint">
              Nothing matches “{query}”.
            </li>
          )}
          {rows.map((row, index) => (
            <li key={row.kind === 'command' ? row.command.id : `g${row.entry.index}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(row)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-1.5 text-left',
                  index === active ? 'bg-accent-soft' : 'hover:bg-hover',
                )}
              >
                {row.kind === 'command' ? (
                  <>
                    <span className="w-14 shrink-0 truncate text-[10px] text-ink-faint">
                      {row.command.group}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-xs',
                          index === active ? 'text-accent' : 'text-ink',
                        )}
                      >
                        {row.command.title}
                      </span>
                      {row.command.hint && (
                        <span className="block truncate text-[10px] text-ink-faint">
                          {row.command.hint}
                        </span>
                      )}
                    </span>
                    {row.command.shortcut && (
                      <kbd className="shrink-0 rounded border border-line px-1 font-mono text-[10px] text-ink-faint">
                        {row.command.shortcut}
                      </kbd>
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-14 shrink-0 text-[10px] text-ink-faint">
                      Glyph
                    </span>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink">
                      {parsed && (
                        <GlyphPreview
                          outline={
                            resolveGlyph(parsed, edits, row.entry.index).outline
                          }
                          unitsPerEm={parsed.verticalMetrics.unitsPerEm}
                          ascender={parsed.verticalMetrics.ascender}
                          descender={parsed.verticalMetrics.descender}
                          advanceWidth={
                            resolveGlyph(parsed, edits, row.entry.index)
                              .advanceWidth
                          }
                          size={18}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">
                      {row.entry.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                      {formatCodepoint(row.entry.unicode)}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex h-7 items-center gap-3 border-t border-line px-3 font-mono text-[10px] text-ink-faint">
          <span className="flex items-center gap-1">
            <CornerDownLeft size={9} /> run
          </span>
          <span>↑↓ navigate</span>
          <span className="flex-1" />
          <span>{rows.length} results</span>
        </div>
      </div>
    </div>
  )
}
