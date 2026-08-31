import { useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import type { Specimen } from '@/engine/library/specimen'
import {
  fitOutlineToMetrics,
  SOURCE_SPACE,
  VERTICAL_FIT,
  type VerticalFit,
} from '@/engine/raster/fitToMetrics'
import { analyzeGlyphStructure } from '@/engine/analysis/glyphStructure'
import { VariantComparison } from '@/features/variants/VariantComparison'
import { describeChanges } from '@/engine/analysis/variants'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'

/**
 * Taking a letter from another typeface into this font.
 *
 * The borrowed drawing is refitted to this font's metrics before anything is
 * committed, and the comparison makes plain that this is a different
 * designer's letter arriving, not an adjustment to the existing one.
 */
export function AdoptDialog({
  parsed,
  glyph,
  specimen,
  onAdopt,
  onClose,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  specimen: Specimen
  onAdopt: (vertical: VerticalFit) => void
  onClose: () => void
}) {
  const [vertical, setVertical] = useState<VerticalFit>(VERTICAL_FIT.XHeight)

  const fitted = useMemo(
    () =>
      fitOutlineToMetrics(specimen.outline, {
        metrics: parsed.verticalMetrics,
        target: {
          bounds: glyph.bounds,
          advanceWidth: glyph.advanceWidth,
          isEmpty: glyph.isEmpty,
        },
        outlineFormat: parsed.metadata.outlineFormat,
        vertical,
        sourceSpace: SOURCE_SPACE.Font,
      }),
    [specimen.outline, parsed, glyph, vertical],
  )

  const char = glyph.unicode !== null ? String.fromCodePoint(glyph.unicode) : null

  const changes = useMemo(() => {
    const current = analyzeGlyphStructure(glyph.outline, { char })
    const candidate = analyzeGlyphStructure(fitted.outline, { char })
    return describeChanges(
      { structure: current, advanceWidth: glyph.advanceWidth },
      { structure: candidate, advanceWidth: fitted.advanceWidth },
      parsed.verticalMetrics.unitsPerEm,
    )
  }, [glyph, fitted, char, parsed.verticalMetrics.unitsPerEm])

  const structure = useMemo(
    () => analyzeGlyphStructure(glyph.outline, { char }),
    [glyph.outline, char],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="text-xs font-semibold text-ink">
            {specimen.family} {specimen.style}
          </h2>
          <span className="text-2xs text-ink-faint">{specimen.label}</span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <X size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <VariantComparison
            before={{
              outline: glyph.outline,
              advanceWidth: glyph.advanceWidth,
              caption: 'This font',
            }}
            after={{
              outline: fitted.outline,
              advanceWidth: fitted.advanceWidth,
              caption: specimen.family,
            }}
            metrics={parsed.verticalMetrics}
            structure={structure}
            changes={changes}
          />

          <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
            <span className="text-2xs text-ink-muted">Scale to</span>
            <Segmented
              value={vertical}
              onChange={setVertical}
              options={[
                { value: VERTICAL_FIT.XHeight, label: 'x-height' },
                { value: VERTICAL_FIT.CapHeight, label: 'Cap height' },
                { value: VERTICAL_FIT.GlyphBounds, label: 'This glyph' },
              ]}
            />
          </div>

          <ul className="mt-3 space-y-0.5">
            {fitted.notes.map((note, index) => (
              <li key={index} className="text-[10px] text-ink-faint">
                {note}
              </li>
            ))}
          </ul>

          {changes.length > 0 && (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-4">
              {changes.map((change) => (
                <div key={change.id} className="contents">
                  <dt className="text-xs text-ink-muted">{change.label}</dt>
                  <dd className="text-xs text-ink">{change.detail}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-3">
          <p className="flex-1 text-2xs text-ink-faint">
            This replaces the drawing with another designer's letter, refitted
            to your metrics. Check the licence of the face you are borrowing
            from.
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onAdopt(vertical)}>
            <Check size={12} />
            Use this drawing
          </Button>
        </footer>
      </div>
    </div>
  )
}
