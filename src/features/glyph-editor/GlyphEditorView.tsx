import { useMemo } from 'react'
import { MousePointerSquareDashed } from 'lucide-react'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { useFontDna } from '@/features/analyzer/useFontDna'
import { usePreviewedGlyphs } from '@/features/transformations/usePreview'
import { MultiGlyphView } from '@/features/transformations/MultiGlyphView'
import { useEditorStore } from '@/store/editorStore'
import { useFontStore } from '@/store/fontStore'
import { CanvasToolbar } from './CanvasToolbar'
import { GlyphCanvas } from './GlyphCanvas'
import { ToolPalette } from './ToolPalette'
import { CompareStrip } from './CompareStrip'

export function GlyphEditorView() {
  const parsed = useFontStore((s) => s.parsed)
  const edits = useFontStore((s) => s.edits)
  const selected = useEditorStore((s) => s.selectedGlyphs)
  const dna = useFontDna()

  const previewed = usePreviewedGlyphs(parsed, selected)
  const originals = useMemo(
    () =>
      parsed ? selected.map((index) => resolveGlyph(parsed, edits, index)) : [],
    [parsed, selected, edits],
  )

  if (!parsed) return null

  if (selected.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <CanvasToolbar />
        <div className="flex min-h-0 flex-1">
          <ToolPalette />
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <MousePointerSquareDashed
              size={22}
              className="text-ink-faint"
              strokeWidth={1.5}
            />
            <p className="text-xs text-ink-muted">Select a glyph to edit it</p>
            <p className="max-w-xs text-2xs text-ink-faint">
              Pick one from the browser on the left, or search for it with{' '}
              <kbd className="rounded border border-line px-1 font-mono">⌘K</kbd>
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (selected.length > 1) {
    return (
      <MultiGlyphView
        glyphs={previewed}
        original={originals}
        metrics={parsed.verticalMetrics}
      />
    )
  }

  const glyph = previewed[0]
  if (!glyph) return null

  return (
    <div className="flex h-full flex-col">
      <CanvasToolbar />
      <div className="flex min-h-0 flex-1">
        <ToolPalette />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <GlyphCanvas parsed={parsed} glyph={glyph} dna={dna} />
          </div>
          <CompareStrip parsed={parsed} dna={dna} />
        </div>
      </div>
    </div>
  )
}
