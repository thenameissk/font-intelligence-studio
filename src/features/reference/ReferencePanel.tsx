import { lazy, Suspense, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { Button } from '@/components/ui/Button'
import { PanelSection } from '@/components/ui/Panel'

// A megabyte of tracing machinery only matters once an image is opened.
const ReferenceDialog = lazy(() =>
  import('./ReferenceDialog').then((m) => ({ default: m.ReferenceDialog })),
)

export function ReferencePanel({
  parsed,
  glyph,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <PanelSection title="Reference image" defaultOpen={false}>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
          Trace a photograph or scan into this glyph, or measure its weight,
          slant and proportion and move this letter towards them. The font’s
          advance width is kept either way.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <ImageIcon size={11} />
          Open reference…
        </Button>
      </PanelSection>

      {open && (
        <Suspense fallback={null}>
          <ReferenceDialog
            parsed={parsed}
            glyph={glyph}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}
