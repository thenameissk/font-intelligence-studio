/**
 * Where the reference library lives.
 *
 * Locally it is a private collection in this browser. On a server it is a
 * shared one: everybody sees the same typefaces, and the studio can show how
 * a letter is drawn across everything the team has collectively gathered.
 * That is the version worth having, and the reason the server exists.
 */
import type { LibraryEntry } from './libraryDb'
import { STORAGE_MODE, type StorageMode } from '@/engine/project/backend'

export interface AddLibraryFontInput {
  family: string
  style: string
  fileName: string
  bytes: ArrayBuffer
  weightClass: number | null
  widthClass: number | null
  isItalic: boolean
  outlineFormat: string
  unitsPerEm: number
  numGlyphs: number
}

export interface LibraryBackend {
  readonly mode: StorageMode
  /** Whether this library is visible to other people. */
  readonly shared: boolean
  list(): Promise<LibraryEntry[]>
  /** The font's bytes, for parsing. Null when it has gone. */
  bytes(id: string): Promise<ArrayBuffer | null>
  add(input: AddLibraryFontInput): Promise<LibraryEntry>
  remove(id: string): Promise<void>
  /** Only offered where emptying the library is the caller's to do. */
  clear?(): Promise<void>
}

export { STORAGE_MODE }
