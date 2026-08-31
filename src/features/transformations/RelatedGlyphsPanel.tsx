import { useMemo } from 'react'
import { Link2 } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { findRelatedGlyphs } from '@/engine/relationships/relationships'
import { GlyphPreview } from '@/components/GlyphPreview'
import { Button } from '@/components/ui/Button'
import { PanelSection } from '@/components/ui/Panel'
import { useEditorStore } from '@/store/editorStore'
import { useFontStore } from '@/store/fontStore'

/**
 * Glyphs that share a skeleton with the current one.
 *
 * Nothing here changes a related glyph on its own: the panel exists so the
 * designer can go and check them, or pull them into the selection and apply
 * the same transformation deliberately.
 */
export function RelatedGlyphsPanel({
  parsed,
  glyph,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
}) {
  const edits = useFontStore((s) => s.edits)
  const selectGlyph = useEditorStore((s) => s.selectGlyph)
  const selectGlyphs = useEditorStore((s) => s.selectGlyphs)

  const related = useMemo(() => {
    const lookup = {
      charToIndex: (char: string): number | null => {
        const codepoint = char.codePointAt(0)
        return codepoint === undefined
          ? null
          : (parsed.cmap.get(codepoint) ?? null)
      },
      indexToChar: (index: number): string | null => {
        const unicode = parsed.glyphs[index]?.unicode
        return unicode === null || unicode === undefined
          ? null
          : String.fromCodePoint(unicode)
      },
    }
    return findRelatedGlyphs(glyph.index, lookup)
  }, [parsed, glyph.index])

  if (related.length === 0) return null

  const modifiedRelatives = related.filter(
    (relative) => edits[relative.glyphIndex] !== undefined,
  ).length

  return (
    <PanelSection title="Related glyphs" defaultOpen={glyph.modified}>
      {glyph.modified && (
        <p className="mb-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs text-ink">
          {glyph.name} was modified. {related.length - modifiedRelatives} of its{' '}
          {related.length} relatives are still untouched.
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1">
        {related.map((relative) => {
          const target = resolveGlyph(parsed, edits, relative.glyphIndex)
          return (
            <button
              key={relative.glyphIndex}
              type="button"
              title={`${relative.char} — ${relative.reason}`}
              onClick={() => selectGlyph(relative.glyphIndex)}
              className="flex flex-col items-center rounded border border-line bg-elevated py-1 text-ink hover:border-accent hover:bg-hover"
            >
              <GlyphPreview
                outline={target.outline}
                unitsPerEm={parsed.verticalMetrics.unitsPerEm}
                ascender={parsed.verticalMetrics.ascender}
                descender={parsed.verticalMetrics.descender}
                advanceWidth={target.advanceWidth}
                size={26}
              />
              <span className="mt-0.5 font-mono text-[9px] text-ink-faint">
                {relative.char}
              </span>
              {target.modified && (
                <span className="h-1 w-1 rounded-full bg-accent" />
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex gap-1">
        <Button
          size="sm"
          onClick={() =>
            selectGlyphs([
              ...related.map((relative) => relative.glyphIndex),
              glyph.index,
            ])
          }
        >
          <Link2 size={11} />
          Select all {related.length + 1}
        </Button>
      </div>

      <p className="mt-2 text-[10px] text-ink-faint">
        Relatives are never changed automatically. Select them to apply the
        same transformation on purpose.
      </p>
    </PanelSection>
  )
}
