import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { FontOverview } from '@/features/analyzer/FontOverview'
import { GlyphEditorView } from '@/features/glyph-editor/GlyphEditorView'
import { Inspector } from '@/features/glyph-editor/Inspector'
import { usePreviewedGlyphs } from '@/features/transformations/usePreview'
import { TransformPanel } from '@/features/transformations/TransformPanel'
import { RelatedGlyphsPanel } from '@/features/transformations/RelatedGlyphsPanel'
import { PathOpsPanel } from '@/features/glyph-editor/PathOpsPanel'
import { AnchorInspector } from '@/features/glyph-editor/AnchorInspector'
import { VariantsPanel } from '@/features/variants/VariantsPanel'
import { ReferencePanel } from '@/features/reference/ReferencePanel'
import { useEditorStore } from '@/store/editorStore'
import { useUiStore, WORKSPACE } from '@/store/uiStore'

// The glyph editor is the landing workspace, so it stays in the main bundle.
// The others are loaded the first time they are opened.
const ValidationView = lazy(() =>
  import('@/features/validation/ValidationView').then((m) => ({
    default: m.ValidationView,
  })),
)
const TypographyView = lazy(() =>
  import('@/features/typography/TypographyView').then((m) => ({
    default: m.TypographyView,
  })),
)
const KerningView = lazy(() =>
  import('@/features/kerning/KerningView').then((m) => ({
    default: m.KerningView,
  })),
)

function Pending() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 size={18} className="animate-spin text-ink-faint" />
    </div>
  )
}

export function WorkspaceCenter({ parsed }: { parsed: ParsedFont }) {
  const workspace = useUiStore((s) => s.workspace)

  switch (workspace) {
    case WORKSPACE.Analyzer:
      return <FontOverview parsed={parsed} />
    case WORKSPACE.Glyphs:
      return <GlyphEditorView />
    case WORKSPACE.Validation:
      return (
        <Suspense fallback={<Pending />}>
          <ValidationView />
        </Suspense>
      )
    case WORKSPACE.Typography:
      return (
        <Suspense fallback={<Pending />}>
          <TypographyView />
        </Suspense>
      )
    case WORKSPACE.Kerning:
      return (
        <Suspense fallback={<Pending />}>
          <KerningView />
        </Suspense>
      )
  }
}

export function WorkspaceInspector({ parsed }: { parsed: ParsedFont }) {
  const selected = useEditorStore((s) => s.selectedGlyphs)
  const glyphs = usePreviewedGlyphs(parsed, selected)
  const primary = glyphs.length > 0 ? glyphs[glyphs.length - 1] : null

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {selected.length > 1 ? (
        <MultiSelectionSummary count={selected.length} />
      ) : (
        <Inspector parsed={parsed} glyph={primary} />
      )}
      {selected.length === 1 && primary && (
        <AnchorInspector glyph={primary} />
      )}
      {selected.length === 1 && primary && (
        <VariantsPanel parsed={parsed} glyph={primary} />
      )}
      {selected.length === 1 && primary && (
        <ReferencePanel parsed={parsed} glyph={primary} />
      )}
      {selected.length === 1 && primary && (
        <PathOpsPanel
          glyph={primary}
          unitsPerEm={parsed.verticalMetrics.unitsPerEm}
        />
      )}
      <TransformPanel
        metrics={parsed.verticalMetrics}
        glyphs={glyphs}
        label={
          selected.length > 1
            ? `${selected.length} glyphs`
            : (primary?.name ?? '')
        }
      />
      {selected.length === 1 && primary && (
        <RelatedGlyphsPanel parsed={parsed} glyph={primary} />
      )}
    </div>
  )
}

function MultiSelectionSummary({ count }: { count: number }) {
  return (
    <div className="border-b border-line px-3 py-4">
      <p className="text-xs font-medium text-ink">{count} glyphs selected</p>
      <p className="mt-1 text-2xs text-ink-muted">
        Transformations below apply to all of them. Preview first, then apply
        as a single undoable step.
      </p>
    </div>
  )
}
