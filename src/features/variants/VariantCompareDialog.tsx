import { Sparkles, X } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import type { GlyphVariant } from '@/engine/analysis/variants'
import {
  constructionLabel,
  CONSTRUCTION,
  type GlyphStructure,
} from '@/engine/analysis/glyphStructure'
import { Button } from '@/components/ui/Button'
import { VariantComparison } from './VariantComparison'

/** The full-size annotated comparison. */
export function VariantCompareDialog({
  parsed,
  glyph,
  variant,
  structure,
  onApply,
  onClose,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  variant: GlyphVariant
  structure: GlyphStructure
  onApply: () => void
  onClose: () => void
}) {
  const caption = (value: GlyphStructure['construction'], fallback: string): string =>
    value === CONSTRUCTION.Unknown ? fallback : constructionLabel(value)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-8 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="text-xs font-semibold text-ink">{variant.label}</h2>
          <span className="text-2xs text-ink-faint">{variant.detail}</span>
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
              caption: caption(structure.construction, 'Current'),
            }}
            after={{
              outline: variant.outline,
              advanceWidth: variant.advanceWidth,
              caption: caption(variant.structure.construction, variant.label),
            }}
            metrics={parsed.verticalMetrics}
            structure={structure}
            changes={variant.changes}
          />

          {variant.changes.length > 0 && (
            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-4">
              {variant.changes.map((change) => (
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
            Replaces the outline and advance width with this font’s own
            drawing. Undoable.
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onApply}>
            <Sparkles size={12} />
            Use this variant
          </Button>
        </footer>
      </div>
    </div>
  )
}
