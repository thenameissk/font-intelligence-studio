import { memo, useMemo } from 'react'
import type { GlyphEdit, GlyphIndexEntry } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { GlyphPreview } from '@/components/GlyphPreview'
import { formatCodepoint } from '@/engine/parser/unicode'
import { cn } from '@/utils/cn'

export const CELL_WIDTH = 62
export const CELL_HEIGHT = 74

/**
 * One glyph in the browser grid.
 *
 * `edit` is passed in rather than read from the store so that editing one
 * glyph re-renders only that cell.
 */
export const GlyphCell = memo(function GlyphCell({
  parsed,
  entry,
  edit,
  selected,
  onSelect,
}: {
  parsed: ParsedFont
  entry: GlyphIndexEntry
  edit: GlyphEdit | undefined
  selected: boolean
  onSelect: (index: number, event: React.MouseEvent) => void
}) {
  const glyph = useMemo(
    () => resolveGlyph(parsed, edit ? { [entry.index]: edit } : {}, entry.index),
    [parsed, entry.index, edit],
  )

  const vm = parsed.verticalMetrics
  const modified = edit !== undefined

  return (
    <button
      type="button"
      onClick={(event) => onSelect(entry.index, event)}
      title={`${entry.name}\n${formatCodepoint(entry.unicode)}\nglyph ${entry.index}`}
      style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
      className={cn(
        'group relative flex flex-col items-center justify-start rounded-md border transition-colors',
        selected
          ? 'border-accent bg-accent-soft'
          : 'border-transparent hover:border-line hover:bg-hover',
      )}
    >
      <div
        className={cn(
          'flex h-[46px] w-full items-center justify-center overflow-hidden',
          selected ? 'text-accent' : 'text-ink',
        )}
      >
        {glyph.isEmpty ? (
          <span className="text-2xs text-ink-faint">·</span>
        ) : (
          <GlyphPreview
            outline={glyph.outline}
            unitsPerEm={vm.unitsPerEm}
            ascender={vm.ascender}
            descender={vm.descender}
            advanceWidth={glyph.advanceWidth}
            size={40}
          />
        )}
      </div>
      <span
        className={cn(
          'w-full truncate px-1 text-center font-mono text-[9px] leading-3',
          selected ? 'text-accent' : 'text-ink-faint',
        )}
      >
        {entry.unicode === null
          ? entry.name
          : entry.unicode.toString(16).toUpperCase().padStart(4, '0')}
      </span>
      <span className="w-full truncate px-1 text-center text-[9px] leading-3 text-ink-faint opacity-0 group-hover:opacity-100">
        {entry.name}
      </span>
      {modified && (
        <span
          aria-label="modified"
          className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
    </button>
  )
})

/** A recommended code point the font does not cover. */
export const MissingCell = memo(function MissingCell({
  codepoint,
  char,
}: {
  codepoint: number
  char: string | null
}) {
  return (
    <div
      style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
      title={`${formatCodepoint(codepoint)} is not in this font`}
      className="flex flex-col items-center justify-start rounded-md border border-dashed border-line-strong"
    >
      <div className="flex h-[46px] w-full items-center justify-center text-lg text-ink-faint opacity-40">
        {char ?? '?'}
      </div>
      <span className="w-full truncate px-1 text-center font-mono text-[9px] leading-3 text-warn">
        {codepoint.toString(16).toUpperCase().padStart(4, '0')}
      </span>
      <span className="text-[9px] leading-3 text-ink-faint">missing</span>
    </div>
  )
})
