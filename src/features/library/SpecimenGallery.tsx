import { useMemo, useState } from 'react'
import { Library, Loader2, X } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import type { Specimen } from '@/engine/library/specimen'
import { groupByConstruction } from '@/engine/library/specimen'
import {
  analyzeGlyphStructure,
  constructionLabel,
} from '@/engine/analysis/glyphStructure'
import { Button } from '@/components/ui/Button'
import { formatCodepoint } from '@/engine/parser/unicode'
import { useLibraryList, useSpecimens } from './useLibrary'
import { SpecimenTile } from './SpecimenTile'

/**
 * The letter, across every typeface in the library, at a size you can
 * actually read.
 *
 * Grouping by construction is the whole point: a wall of a's teaches less
 * than two labelled groups showing that some designers build the letter in
 * one storey and some in two.
 */
export function SpecimenGallery({
  parsed,
  glyph,
  onPick,
  onManageLibrary,
  onClose,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  onPick: (specimen: Specimen) => void
  onManageLibrary: () => void
  onClose: () => void
}) {
  const { entries } = useLibraryList()
  const codepoint = glyph.unicode
  const { specimens, done, total, missing, loading } = useSpecimens(
    entries,
    codepoint,
  )
  const [size, setSize] = useState(96)

  const char = codepoint !== null ? String.fromCodePoint(codepoint) : null
  const structure = useMemo(
    () => analyzeGlyphStructure(glyph.outline, { char }),
    [glyph.outline, char],
  )
  const groups = useMemo(() => groupByConstruction(specimens), [specimens])

  // The open font, shown the same way as the references so it can be
  // compared against them rather than merely described.
  const own: Specimen = useMemo(
    () => ({
      fontId: 'current',
      family: parsed.metadata.names.fontFamily ?? 'This font',
      style: parsed.metadata.names.fontSubfamily ?? '',
      outline: glyph.outline,
      advanceWidth: glyph.advanceWidth,
      unitsPerEm: parsed.verticalMetrics.unitsPerEm,
      ascender: parsed.verticalMetrics.ascender,
      descender: parsed.verticalMetrics.descender,
      xHeight: parsed.verticalMetrics.xHeight,
      capHeight: parsed.verticalMetrics.capHeight,
      construction: structure.construction,
      serif: '',
      weightName: '',
      widthName: null,
      isItalic: false,
      label: constructionLabel(structure.construction),
    }),
    [parsed, glyph, structure],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
      >
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-3">
          <h2 className="text-xs font-semibold text-ink">
            {char ? `“${char}”` : glyph.name} across the library
          </h2>
          <span className="font-mono text-2xs text-ink-faint">
            {formatCodepoint(codepoint)}
          </span>
          {loading && (
            <span className="flex items-center gap-1 text-2xs text-ink-faint">
              <Loader2 size={11} className="animate-spin" />
              {done}/{total}
            </span>
          )}
          <span className="flex-1" />
          <input
            type="range"
            min={56}
            max={190}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            aria-label="Specimen size"
            className="w-28 accent-[var(--fis-accent)]"
          />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <X size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <section className="mb-5">
            <h3 className="mb-2 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
              The font you are editing
            </h3>
            <div className="w-40">
              <SpecimenTile specimen={own} size={size} selected />
            </div>
          </section>

          {groups.map((group) => (
            <section key={group.construction} className="mb-5">
              <h3 className="mb-2 flex items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">
                  {group.label}
                </span>
                <span className="font-mono text-2xs text-ink-faint">
                  {group.specimens.length}
                </span>
                {group.construction === structure.construction && (
                  <span className="rounded-sm bg-accent-soft px-1.5 py-px text-[10px] text-accent">
                    same construction as this font
                  </span>
                )}
              </h3>
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${size + 40}px, 1fr))`,
                }}
              >
                {group.specimens.map((specimen) => (
                  <SpecimenTile
                    key={specimen.fontId}
                    specimen={specimen}
                    size={size}
                    onClick={() => onPick(specimen)}
                  />
                ))}
              </div>
            </section>
          ))}

          {!loading && specimens.length === 0 && (
            <p className="py-10 text-center text-xs text-ink-faint">
              {entries.length === 0
                ? 'The reference library is empty.'
                : `None of the ${entries.length} fonts in the library draw this character.`}
            </p>
          )}

          {missing > 0 && (
            <p className="text-2xs text-ink-faint">
              {missing} font{missing === 1 ? ' does' : 's do'} not draw this
              character.
            </p>
          )}
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-3">
          <p className="flex-1 text-2xs text-ink-faint">
            Click a specimen to compare it against your glyph and, if you want
            it, borrow the drawing.
          </p>
          <Button onClick={onManageLibrary}>
            <Library size={12} />
            Manage library ({entries.length})
          </Button>
          <Button onClick={onClose}>Done</Button>
        </footer>
      </div>
    </div>
  )
}
