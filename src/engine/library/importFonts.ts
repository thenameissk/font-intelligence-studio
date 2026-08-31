/**
 * Getting typefaces into the reference library.
 *
 * Two ways in: files the user picks or drops, and -- where the browser
 * offers it -- the fonts already installed on the machine. The second is
 * behind a permission prompt and only exists in some browsers, so it is
 * offered when available and never depended on.
 */
import { parseFontFile } from '@/engine/parser/parseFont'
import { displayFamilyName, displayStyleName } from '@/engine/parser/metadata'
import type { LibraryEntry } from './libraryDb'
import { currentLibraryBackend } from '@/store/sessionStore'

export interface ImportOutcome {
  added: LibraryEntry[]
  failed: Array<{ name: string; reason: string }>
}

async function addOne(
  name: string,
  buffer: ArrayBuffer,
): Promise<LibraryEntry> {
  const parsed = await parseFontFile({ name, buffer })
  return currentLibraryBackend().add({
    family: displayFamilyName(parsed.metadata),
    style: displayStyleName(parsed.metadata),
    fileName: name,
    // The sfnt rather than the original wrapper: a WOFF would otherwise be
    // decompressed again on every read.
    bytes: parsed.sfnt.slice(0),
    weightClass: parsed.metadata.weightClass,
    widthClass: parsed.metadata.widthClass,
    isItalic: parsed.metadata.isItalic,
    outlineFormat: parsed.metadata.outlineFormat,
    unitsPerEm: parsed.verticalMetrics.unitsPerEm,
    numGlyphs: parsed.metadata.numGlyphs,
  })
}

export async function importFontFiles(
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const added: LibraryEntry[] = []
  const failed: ImportOutcome['failed'] = []

  for (const [index, file] of files.entries()) {
    try {
      added.push(await addOne(file.name, await file.arrayBuffer()))
    } catch (error) {
      failed.push({
        name: file.name,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
    onProgress?.(index + 1, files.length)
  }

  return { added, failed }
}

// ---------------------------------------------------------------------------
// Installed fonts
// ---------------------------------------------------------------------------

interface FontData {
  family: string
  fullName: string
  postscriptName: string
  style: string
  blob(): Promise<Blob>
}

interface LocalFontWindow {
  queryLocalFonts?: () => Promise<FontData[]>
}

export function supportsLocalFonts(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as LocalFontWindow).queryLocalFonts === 'function'
  )
}

export interface InstalledFace {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

/**
 * Lists the fonts installed on this machine.
 *
 * Requires a permission the user grants explicitly, and only Chromium
 * browsers implement it. Callers must handle the empty case as normal
 * rather than an error.
 */
export async function listInstalledFonts(): Promise<InstalledFace[]> {
  const query = (window as LocalFontWindow).queryLocalFonts
  if (!query) return []
  const faces = await query()
  return faces.map((face) => ({
    family: face.family,
    fullName: face.fullName,
    postscriptName: face.postscriptName,
    style: face.style,
  }))
}

/**
 * Adds installed fonts by PostScript name.
 *
 * One face per family by default: a library holding fourteen weights of one
 * typeface tells a designer far less than fourteen typefaces would.
 */
export async function importInstalledFonts(
  postscriptNames: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const query = (window as LocalFontWindow).queryLocalFonts
  if (!query) {
    return {
      added: [],
      failed: [{ name: 'installed fonts', reason: 'This browser cannot list installed fonts.' }],
    }
  }

  const wanted = new Set(postscriptNames)
  const faces = (await query()).filter((face) => wanted.has(face.postscriptName))

  const added: LibraryEntry[] = []
  const failed: ImportOutcome['failed'] = []

  for (const [index, face] of faces.entries()) {
    try {
      const blob = await face.blob()
      added.push(await addOne(face.postscriptName, await blob.arrayBuffer()))
    } catch (error) {
      failed.push({
        name: face.fullName || face.postscriptName,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
    onProgress?.(index + 1, faces.length)
  }

  return { added, failed }
}

/** One representative face per family, preferring an upright regular. */
export function pickOnePerFamily(faces: readonly InstalledFace[]): InstalledFace[] {
  const byFamily = new Map<string, InstalledFace>()
  const score = (face: InstalledFace): number => {
    const style = face.style.toLowerCase()
    let value = 0
    if (/regular|book|roman|normal/.test(style)) value += 4
    if (/italic|oblique/.test(style)) value -= 3
    if (/bold|black|heavy|light|thin|condensed|expanded/.test(style)) value -= 1
    return value
  }
  for (const face of faces) {
    const existing = byFamily.get(face.family)
    if (!existing || score(face) > score(existing)) byFamily.set(face.family, face)
  }
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family))
}
