import type { ResolvedGlyph } from '@/types/font'
import type { VerticalMetrics } from '@/types/font'
import { GlyphPreview } from '@/components/GlyphPreview'
import { useEditorStore } from '@/store/editorStore'
import { useTransformStore } from '@/store/transformStore'
import { formatUnits } from '@/utils/format'
import { cn } from '@/utils/cn'

/**
 * Multi-glyph editing surface.
 *
 * Shows every selected glyph with the pending transformation applied, so a
 * change can be judged across the whole set before it is committed.
 */
export function MultiGlyphView({
  glyphs,
  original,
  metrics,
}: {
  glyphs: readonly ResolvedGlyph[]
  original: readonly ResolvedGlyph[]
  metrics: VerticalMetrics
}) {
  const spec = useTransformStore((s) => s.spec)
  const selectGlyph = useEditorStore((s) => s.selectGlyph)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-xs font-medium text-ink">
          {glyphs.length} glyphs selected
        </span>
        {spec && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-2xs text-accent">
            previewing changes
          </span>
        )}
        <span className="flex-1" />
        <span className="font-mono text-2xs text-ink-faint">
          click a glyph to edit it on its own
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
          {glyphs.map((glyph, index) => {
            const before = original[index]
            const changed =
              before !== undefined &&
              (before.advanceWidth !== glyph.advanceWidth ||
                before.outline !== glyph.outline)
            return (
              <button
                key={glyph.index}
                type="button"
                onDoubleClick={() => selectGlyph(glyph.index)}
                className={cn(
                  'flex flex-col items-center rounded-md border p-2 transition-colors',
                  changed
                    ? 'border-accent/60 bg-accent-soft/25'
                    : 'border-line bg-panel hover:bg-hover',
                )}
              >
                <div className="relative flex h-16 w-full items-center justify-center text-ink">
                  {before && changed && (
                    <span className="absolute inset-0 flex items-center justify-center text-ink-faint opacity-30">
                      <GlyphPreview
                        outline={before.outline}
                        unitsPerEm={metrics.unitsPerEm}
                        ascender={metrics.ascender}
                        descender={metrics.descender}
                        advanceWidth={before.advanceWidth}
                        size={58}
                      />
                    </span>
                  )}
                  <GlyphPreview
                    outline={glyph.outline}
                    unitsPerEm={metrics.unitsPerEm}
                    ascender={metrics.ascender}
                    descender={metrics.descender}
                    advanceWidth={glyph.advanceWidth}
                    size={58}
                  />
                </div>
                <span className="mt-1 w-full truncate text-center font-mono text-2xs text-ink-muted">
                  {glyph.name}
                </span>
                <span className="font-mono text-[10px] tabular text-ink-faint">
                  {formatUnits(glyph.advanceWidth)}
                  {before && before.advanceWidth !== glyph.advanceWidth && (
                    <span className="text-accent">
                      {' '}
                      ← {formatUnits(before.advanceWidth)}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
