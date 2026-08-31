/**
 * The reference library: other typefaces, kept so the studio can show how a
 * letter is drawn elsewhere.
 *
 * Fonts are stored whole rather than as extracted specimens. A specimen
 * would have to guess in advance which characters mattered, and the whole
 * point is to be able to ask about any of them later.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { createId } from '@/utils/id'

export interface LibraryFont {
  id: string
  /** Family name as the font declares it. */
  family: string
  style: string
  fileName: string
  addedAt: number
  bytes: ArrayBuffer
  /** Cheap facts pulled once at add time, so listing needs no parsing. */
  weightClass: number | null
  widthClass: number | null
  isItalic: boolean
  outlineFormat: string
  unitsPerEm: number
  numGlyphs: number
}

export type LibraryEntry = Omit<LibraryFont, 'bytes'>

interface Schema extends DBSchema {
  'library-fonts': {
    key: string
    value: LibraryFont
    indexes: { family: string }
  }
}

const DB_NAME = 'font-intelligence-library'
const DB_VERSION = 1

/** A cap, so a library cannot quietly consume a browser storage quota. */
export const MAX_LIBRARY_FONTS = 60

let database: Promise<IDBPDatabase<Schema>> | null = null

function db(): Promise<IDBPDatabase<Schema>> {
  if (!database) {
    database = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(instance) {
        const store = instance.createObjectStore('library-fonts', {
          keyPath: 'id',
        })
        store.createIndex('family', 'family')
      },
    })
  }
  return database
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const all = await (await db()).getAll('library-fonts')
  return all
    .map(({ bytes: _bytes, ...rest }) => rest)
    .sort(
      (a, b) =>
        a.family.localeCompare(b.family) || a.style.localeCompare(b.style),
    )
}

export async function getLibraryFont(id: string): Promise<LibraryFont | null> {
  return (await (await db()).get('library-fonts', id)) ?? null
}

export async function addLibraryFont(
  input: Omit<LibraryFont, 'id' | 'addedAt'>,
): Promise<LibraryEntry> {
  const instance = await db()
  const existing = await instance.getAll('library-fonts')

  // The same face added twice is noise in the grid, not a second opinion.
  const duplicate = existing.find(
    (entry) =>
      entry.family === input.family &&
      entry.style === input.style &&
      entry.numGlyphs === input.numGlyphs,
  )
  if (duplicate) {
    const { bytes: _bytes, ...rest } = duplicate
    return rest
  }

  if (existing.length >= MAX_LIBRARY_FONTS) {
    throw new Error(
      `The library holds ${MAX_LIBRARY_FONTS} fonts. Remove one before adding another.`,
    )
  }

  const record: LibraryFont = { ...input, id: createId('lib'), addedAt: Date.now() }
  await instance.put('library-fonts', record)
  const { bytes: _bytes, ...rest } = record
  return rest
}

export async function removeLibraryFont(id: string): Promise<void> {
  await (await db()).delete('library-fonts', id)
}

export async function clearLibrary(): Promise<void> {
  await (await db()).clear('library-fonts')
}

export async function libraryCount(): Promise<number> {
  return (await db()).count('library-fonts')
}
