import { useMemo } from 'react'
import type { FontDna } from '@/types/analysis'
import { analyzeFontDna } from '@/engine/analysis/fontDna'
import { createDnaSource } from '@/engine/analysis/dnaSource'
import { useFontStore } from '@/store/fontStore'

/**
 * Font DNA for the current document.
 *
 * Recomputed when the font or its edits change. The whole analysis measures
 * a few dozen glyphs, so it stays well inside a frame even for large fonts;
 * the heavier whole-font QA pass is what runs in a worker.
 */
export function useFontDna(): FontDna | null {
  const parsed = useFontStore((s) => s.parsed)
  const edits = useFontStore((s) => s.edits)

  return useMemo(() => {
    if (!parsed) return null
    return analyzeFontDna(createDnaSource(parsed, edits))
  }, [parsed, edits])
}
