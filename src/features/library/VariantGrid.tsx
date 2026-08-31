import { useMemo, useState } from 'react'
import { Library, Loader2, Maximize2 } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import type { Specimen } from '@/engine/library/specimen'
import { groupByConstruction } from '@/engine/library/specimen'
import { analyzeGlyphStructure, constructionLabel } from '@/engine/analysis/glyphStructure'
import {
  fitOutlineToMetrics,
  SOURCE_SPACE,
  type VerticalFit,
} from '@/engine/raster/fitToMetrics'
import { Button } from '@/components/ui/Button'
import { useHistoryStore } from '@/store/historyStore'
import { useLibraryList, useSpecimens } from './useLibrary'
import { SpecimenTile } from './SpecimenTile'
import { AdoptDialog } from './AdoptDialog'
import { SpecimenGallery } from './SpecimenGallery'

/**
 * How this letter is drawn across the reference library, grouped by
 * construction so the difference that matters is the one you see first.
 */
export function VariantGrid({
  parsed,
  glyph,
  onManageLibrary,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  onManageLibrary: () => void
}) {
  const { entries } = useLibraryList()
  const codepoint = glyph.unicode
  const { specimens, done, total, loading } = useSpecimens(entries, codepoint)
  const [chosen, setChosen] = useState<Specimen | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const currentStructure = useMemo(
    () =>
      analyzeGlyphStructure(glyph.outline, {
        char: codepoint !== null ? String.fromCodePoint(codepoint) : null,
      }),
    [glyph.outline, codepoint],
  )

  const groups = useMemo(() => groupByConstruction(specimens), [specimens])

  if (codepoint === null) {
    return (
      <p className="text-2xs text-ink-faint">
        This glyph is not mapped to a character, so there is nothing to
        compare it against.
      </p>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="rounded border border-line bg-input p-3">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Add typefaces to the reference library and this shows how each of
          them draws{' '}
          <span className="font-medium text-ink">
            {String.fromCodePoint(codepoint)}
          </span>
          , grouped by construction.
        </p>
        <Button size="sm" className="mt-2" onClick={onManageLibrary}>
          <Library size={11} />
          Build the library
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <p className="flex-1 text-[10px] text-ink-faint">
          This font draws it {constructionLabel(currentStructure.construction).toLowerCase()}.
          {' '}
          {specimens.length} of {total} reference face
          {total === 1 ? '' : 's'} draw it too.
        </p>
        {loading && (
          <span className="flex items-center gap-1 text-[10px] text-ink-faint">
            <Loader2 size={10} className="animate-spin" />
            {done}/{total}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <section key={group.construction}>
            <h4 className="mb-1.5 flex items-baseline gap-1.5">
              <span className="text-2xs font-semibold text-ink">
                {group.label}
              </span>
              <span className="font-mono text-[10px] text-ink-faint">
                {group.specimens.length}
              </span>
              {group.construction === currentStructure.construction && (
                <span className="rounded-sm bg-accent-soft px-1 text-[9px] text-accent">
                  same as this font
                </span>
              )}
            </h4>
            <div className="grid grid-cols-3 gap-1.5">
              {group.specimens.map((specimen) => (
                <SpecimenTile
                  key={specimen.fontId}
                  specimen={specimen}
                  size={58}
                  onClick={() => setChosen(specimen)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {specimens.length === 0 && !loading && (
        <p className="mt-2 text-2xs text-ink-faint">
          None of the {total} fonts in the library draw this character.
        </p>
      )}

      <div className="mt-3 flex gap-1">
        <Button size="sm" onClick={() => setGalleryOpen(true)}>
          <Maximize2 size={11} />
          See them all
        </Button>
        <Button size="sm" onClick={onManageLibrary}>
          <Library size={11} />
          Library ({entries.length})
        </Button>
      </div>

      {galleryOpen && (
        <SpecimenGallery
          parsed={parsed}
          glyph={glyph}
          onPick={(specimen) => {
            setGalleryOpen(false)
            setChosen(specimen)
          }}
          onManageLibrary={() => {
            setGalleryOpen(false)
            onManageLibrary()
          }}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {chosen && (
        <AdoptDialog
          parsed={parsed}
          glyph={glyph}
          specimen={chosen}
          onClose={() => setChosen(null)}
          onAdopt={(vertical: VerticalFit) => {
            const fitted = fitOutlineToMetrics(chosen.outline, {
              metrics: parsed.verticalMetrics,
              target: {
                bounds: glyph.bounds,
                advanceWidth: glyph.advanceWidth,
                isEmpty: glyph.isEmpty,
              },
              outlineFormat: parsed.metadata.outlineFormat,
              vertical,
              // Borrowed from another font, so already the right way up.
              sourceSpace: SOURCE_SPACE.Font,
            })
            useHistoryStore.getState().commit(
              `Adopt ${chosen.family} ${String.fromCodePoint(codepoint)}`,
              {
                [glyph.index]: {
                  outline: fitted.outline,
                  advanceWidth: fitted.advanceWidth,
                },
              },
            )
            setChosen(null)
          }}
        />
      )}
    </>
  )
}
