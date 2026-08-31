/**
 * The font document: the immutable imported font plus the edit overlay.
 *
 * Mutating actions live here, but they are intentionally low level -- the
 * history layer wraps them so every user-visible change is an undoable
 * command rather than an ad-hoc setState.
 */
import { create } from 'zustand'
import type { GlyphEdit, GlyphEdits, ImportWarning } from '@/types/font'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'

export type DocumentStatus = 'empty' | 'loading' | 'ready' | 'error'

export interface FontState {
  status: DocumentStatus
  parsed: ParsedFont | null
  edits: GlyphEdits
  /** Kerning overrides keyed by "left,right" glyph index pair. */
  kerningEdits: Readonly<Record<string, number>>
  warnings: ImportWarning[]
  error: string | null
  /** Bumped on every geometry change so memoised views can invalidate. */
  revision: number

  importFile: (file: File) => Promise<void>
  importUrl: (url: string, fileName?: string) => Promise<void>
  closeFont: () => void
  applyGlyphEdits: (changes: Record<number, GlyphEdit | null>) => void
  setKerning: (left: number, right: number, value: number | null) => void
  replaceState: (edits: GlyphEdits, kerningEdits: Record<string, number>) => void
}

export const useFontStore = create<FontState>((set, get) => {
  const load = async (
    read: () => Promise<{ name: string; buffer: ArrayBuffer }>,
  ): Promise<void> => {
    set({ status: 'loading', error: null, warnings: [] })
    try {
      const parsed = await parseFontFile(await read())
      set({
        status: 'ready',
        parsed,
        edits: {},
        kerningEdits: {},
        warnings: [...parsed.warnings],
        error: null,
        revision: get().revision + 1,
      })
    } catch (error) {
      set({
        status: 'error',
        parsed: null,
        edits: {},
        kerningEdits: {},
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    status: 'empty',
    parsed: null,
    edits: {},
    kerningEdits: {},
    warnings: [],
    error: null,
    revision: 0,

    importFile: (file) =>
      load(async () => ({ name: file.name, buffer: await file.arrayBuffer() })),

    importUrl: (url, fileName) =>
      load(async () => {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Could not fetch font (HTTP ${response.status}).`)
        }
        return {
          name: fileName ?? url.split('/').pop() ?? 'font',
          buffer: await response.arrayBuffer(),
        }
      }),

    closeFont: () =>
      set({
        status: 'empty',
        parsed: null,
        edits: {},
        kerningEdits: {},
        warnings: [],
        error: null,
        revision: get().revision + 1,
      }),

    applyGlyphEdits: (changes) => {
      const next: Record<number, GlyphEdit> = { ...get().edits }
      for (const [key, value] of Object.entries(changes)) {
        const index = Number(key)
        if (value === null) delete next[index]
        else next[index] = value
      }
      set({ edits: next, revision: get().revision + 1 })
    },

    setKerning: (left, right, value) => {
      const key = `${left},${right}`
      const next = { ...get().kerningEdits }
      if (value === null) delete next[key]
      else next[key] = value
      set({ kerningEdits: next, revision: get().revision + 1 })
    },

    replaceState: (edits, kerningEdits) =>
      set({ edits, kerningEdits, revision: get().revision + 1 }),
  }
})

export const selectParsed = (state: FontState): ParsedFont | null => state.parsed
export const selectEdits = (state: FontState): GlyphEdits => state.edits
