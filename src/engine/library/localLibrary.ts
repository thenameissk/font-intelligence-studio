/**
 * The reference library in this browser. Private to whoever is sitting here.
 */
import {
  addLibraryFont,
  clearLibrary,
  getLibraryFont,
  listLibrary,
  removeLibraryFont,
  type LibraryEntry,
} from './libraryDb'
import { STORAGE_MODE, type AddLibraryFontInput, type LibraryBackend } from './backend'

export const localLibrary: LibraryBackend = {
  mode: STORAGE_MODE.Local,
  shared: false,

  list(): Promise<LibraryEntry[]> {
    return listLibrary()
  },

  async bytes(id: string): Promise<ArrayBuffer | null> {
    const record = await getLibraryFont(id)
    return record ? record.bytes.slice(0) : null
  },

  add(input: AddLibraryFontInput): Promise<LibraryEntry> {
    return addLibraryFont(input)
  },

  remove(id: string): Promise<void> {
    return removeLibraryFont(id)
  },

  clear(): Promise<void> {
    return clearLibrary()
  },
}
