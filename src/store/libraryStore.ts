/**
 * The reference library listing, shared.
 *
 * It has to be one source of truth rather than per-component state: fonts
 * are added in the library dialog and consumed by the variant grid, and two
 * independent copies mean adding a typeface appears to do nothing.
 */
import { create } from 'zustand'
import type { LibraryEntry } from '@/engine/library/libraryDb'
import { clearSpecimenCache } from '@/engine/library/specimen'
import { currentLibraryBackend } from '@/store/sessionStore'

export interface LibraryState {
  entries: LibraryEntry[]
  loading: boolean
  loaded: boolean
  /** True when this library is visible to the rest of the team. */
  shared: boolean
  /** Set when the library could not be read at all. */
  error: string | null
  refresh: () => Promise<void>
  ensureLoaded: () => void
  remove: (id: string) => Promise<void>
  empty: () => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  entries: [],
  loading: false,
  loaded: false,
  shared: false,
  error: null,

  refresh: async () => {
    const backend = currentLibraryBackend()
    set({ loading: true, error: null })
    try {
      const entries = await backend.list()
      // Parsed fonts are cached by id; a changed listing may have
      // invalidated some of them.
      clearSpecimenCache()
      set({ entries, loading: false, loaded: true, shared: backend.shared })
    } catch (error) {
      set({
        entries: [],
        loading: false,
        loaded: true,
        shared: backend.shared,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  ensureLoaded: () => {
    if (get().loaded || get().loading) return
    void get().refresh()
  },

  remove: async (id) => {
    await currentLibraryBackend().remove(id)
    await get().refresh()
  },

  empty: async () => {
    const backend = currentLibraryBackend()
    // Emptying a shared library is not one person's decision, so the
    // server backend does not offer it.
    if (!backend.clear) {
      throw new Error(
        'A shared library is emptied one face at a time, by whoever added them.',
      )
    }
    await backend.clear()
    await get().refresh()
  },
}))
