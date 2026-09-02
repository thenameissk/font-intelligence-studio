import { useMemo, useState } from 'react'
import { Check, Columns2, Sparkles } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import {
  analyzeVariants,
  type GlyphVariant,
} from '@/engine/analysis/variants'
import { constructionLabel, CONSTRUCTION } from '@/engine/analysis/glyphStructure'
import { GlyphPreview } from '@/components/GlyphPreview'
import { Button } from '@/components/ui/Button'
import { PanelSection, Row, Value } from '@/components/ui/Panel'
import { useFontStore } from '@/store/fontStore'
import { useHistoryStore } from '@/store/historyStore'
import { VariantCompareDialog } from './VariantCompareDialog'
import { VariantGrid } from '@/features/library/VariantGrid'
import { LibraryDialog } from '@/features/library/LibraryDialog'

/**
 * The variants inspector: what this glyph is, and what else the font can
 * make it.
 */
export function VariantsPanel({
  parsed,
  glyph,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
}) {
  const edits = useFontStore((s) => s.edits)
  const commit = useHistoryStore((s) => s.commit)
  const [comparing, setComparing] = useState<GlyphVariant | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const report = useMemo(
    () => analyzeVariants(parsed, edits, glyph.index),
    [parsed, edits, glyph.index],
  )

  const apply = (variant: GlyphVariant): void => {
    commit(`Use ${variant.label}`, {
      [glyph.index]: {
        outline: variant.outline,
        advanceWidth: variant.advanceWidth,
      },
    })
  }

  const { structure } = report

  return (
    <>
      <PanelSection
        title="Variants"
        defaultOpen
        actions={
          report.variants.length > 0 ? (
            <span className="rounded-sm bg-accent-soft px-1 py-px font-mono text-[10px] text-accent">
              {report.variants.length}
            </span>
          ) : undefined
        }
      >
        {/* What the letter is, measured from its own outline. */}
        <div className="mb-2">
          {structure.construction !== CONSTRUCTION.Unknown && (
            <Row label="Construction">
              <Value>{constructionLabel(structure.construction)}</Value>
            </Row>
          )}
          <Row label="Counters">
            <Value muted={structure.counters.length === 0}>
              {structure.counters.length === 0
                ? 'None enclosed'
                : structure.counters
                    .map((counter) => counter.band)
                    .join(', ')}
            </Value>
          </Row>
          {structure.junction && (
            <Row label="Thinnest join" title="Narrowest ink through the middle band">
              <Value mono>{Math.round(structure.junction.thickness)} units</Value>
            </Row>
          )}
          {structure.tail && (
            <Row label="Tail">
              <Value mono>reaches {Math.round(structure.tail.reach)} units</Value>
            </Row>
          )}
        </div>

        <p className="mb-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
          In this font
        </p>
        {report.variants.length === 0 ? (
          <div className="rounded border border-line bg-input px-2 py-1.5">
            <p className="text-[11px] leading-relaxed text-ink-muted">
              {report.emptyReason}
            </p>

            {/* Naming the letters that do have alternates answers the question
                the bare message leaves open: whether the font has none, or
                has them and simply not for this glyph. */}
            {report.alternatesElsewhere.examples.length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                It does offer them for{' '}
                <span className="font-mono text-ink-muted">
                  {report.alternatesElsewhere.examples.join(' ')}
                </span>
                {report.alternatesElsewhere.count >
                  report.alternatesElsewhere.examples.length && ' and others'}
                .
              </p>
            )}

            {report.rejected.map((candidate) => (
              <p
                key={candidate.glyphName}
                className="mt-1 text-[11px] leading-relaxed text-ink-faint"
              >
                Not offered: {candidate.reason}.
              </p>
            ))}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {report.variants.map((variant) => (
              <li key={variant.id}>
                <VariantCard
                  parsed={parsed}
                  glyph={glyph}
                  variant={variant}
                  onApply={() => apply(variant)}
                  onCompare={() => setComparing(variant)}
                />
              </li>
            ))}
          </ul>
        )}

        {/* Most faces ship no alternates at all -- Georgia, Verdana, Trebuchet
            and STIX expose none between them -- so for nearly every glyph the
            only real answer to "what else could this be" comes from other
            typefaces. Keeping it behind a collapsed panel below a dead end
            made the whole question look unanswerable. */}
        <p className="mt-3 mb-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
          In other typefaces
        </p>
        <VariantGrid
          parsed={parsed}
          glyph={glyph}
          onManageLibrary={() => setLibraryOpen(true)}
        />
      </PanelSection>

      {libraryOpen && <LibraryDialog onClose={() => setLibraryOpen(false)} />}

      {comparing && (
        <VariantCompareDialog
          parsed={parsed}
          glyph={glyph}
          variant={comparing}
          structure={structure}
          onApply={() => {
            apply(comparing)
            setComparing(null)
          }}
          onClose={() => setComparing(null)}
        />
      )}
    </>
  )
}

function VariantCard({
  parsed,
  glyph,
  variant,
  onApply,
  onCompare,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  variant: GlyphVariant
  onApply: () => void
  onCompare: () => void
}) {
  const applied =
    glyph.modified &&
    Math.abs(glyph.advanceWidth - variant.advanceWidth) < 1 &&
    glyph.outline.contours.length === variant.outline.contours.length

  return (
    <div className="rounded-md border border-line bg-elevated p-2">
      <div className="flex items-start gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-line bg-panel text-ink">
          <GlyphPreview
            outline={variant.outline}
            unitsPerEm={parsed.verticalMetrics.unitsPerEm}
            ascender={parsed.verticalMetrics.ascender}
            descender={parsed.verticalMetrics.descender}
            advanceWidth={variant.advanceWidth}
            size={34}
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">{variant.label}</p>
          <p className="mt-0.5 text-[10px] leading-snug text-ink-faint">
            {variant.source === 'feature' ? (
              <>
                <span className="font-mono text-accent">
                  {(variant.featureTags ?? [variant.featureTag])
                    .filter(Boolean)
                    .map((tag) => tag!.toUpperCase())
                    .join(' · ')}
                </span>{' '}
                · from this font
              </>
            ) : (
              'Structural twin in this font'
            )}
            <span className="ml-1 font-mono">{variant.glyphName}</span>
          </p>
        </div>
      </div>

      {variant.changes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {variant.changes.slice(0, 3).map((change) => (
            <li key={change.id} className="flex gap-1.5 text-[10px]">
              <span className="w-16 shrink-0 truncate text-ink-muted">
                {change.label}
              </span>
              <span className="min-w-0 flex-1 text-ink">{change.detail}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-1">
        <Button size="sm" onClick={onCompare}>
          <Columns2 size={11} />
          Compare
        </Button>
        <Button
          size="sm"
          variant={applied ? 'default' : 'primary'}
          onClick={onApply}
        >
          {applied ? <Check size={11} /> : <Sparkles size={11} />}
          {applied ? 'Applied' : 'Use this'}
        </Button>
      </div>
    </div>
  )
}
