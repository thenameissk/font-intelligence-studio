/**
 * The shared reference library, on the server.
 *
 * Font bytes are fetched on demand and cached, because the comparison grid
 * asks for the same faces every time the selected glyph changes and
 * re-downloading a set of typefaces for each keystroke would be absurd.
 */
import { request } from '@/engine/server/session'
import type { LibraryEntry } from './libraryDb'
import { STORAGE_MODE, type AddLibraryFontInput, type LibraryBackend } from './backend'

interface RemoteFont {
  id: string
  family: string
  style: string
  fileName: string
  fontUrl: string
  weightClass: number | null
  widthClass: number | null
  isItalic: boolean
  outlineFormat: string
  unitsPerEm: number
  numGlyphs: number
  addedBy: string | null
  addedAt: number
}

function toEntry(font: RemoteFont): LibraryEntry {
  return {
    id: font.id,
    family: font.family,
    style: font.style,
    fileName: font.fileName,
    addedAt: font.addedAt,
    weightClass: font.weightClass,
    widthClass: font.widthClass,
    isItalic: font.isItalic,
    outlineFormat: font.outlineFormat,
    unitsPerEm: font.unitsPerEm,
    numGlyphs: font.numGlyphs,
  }
}

/** id -> font bytes. Downloads are the expensive part, not the parsing. */
const downloads = new Map<string, Promise<ArrayBuffer | null>>()
/** id -> URL, remembered from the last listing. */
const urls = new Map<string, string>()

export function clearRemoteLibraryCache(): void {
  downloads.clear()
  urls.clear()
}

export const remoteLibrary: LibraryBackend = {
  mode: STORAGE_MODE.Server,
  shared: true,

  async list(): Promise<LibraryEntry[]> {
    const body = await request<{ fonts: RemoteFont[] }>('library/')
    for (const font of body.fonts) urls.set(font.id, font.fontUrl)
    return body.fonts.map(toEntry)
  },

  async bytes(id: string): Promise<ArrayBuffer | null> {
    const cached = downloads.get(id)
    if (cached) return cached

    const url = urls.get(id)
    if (!url) return null

    const pending = fetch(url, { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null)

    downloads.set(id, pending)
    return pending
  },

  async add(input: AddLibraryFontInput): Promise<LibraryEntry> {
    const form = new FormData()
    form.set('family', input.family)
    form.set('style', input.style)
    form.set('weightClass', String(input.weightClass ?? ''))
    form.set('widthClass', String(input.widthClass ?? ''))
    form.set('isItalic', String(input.isItalic))
    form.set('outlineFormat', input.outlineFormat)
    form.set('unitsPerEm', String(input.unitsPerEm))
    form.set('numGlyphs', String(input.numGlyphs))
    form.set(
      'font',
      new Blob([input.bytes], { type: 'font/otf' }),
      input.fileName,
    )

    const created = await request<RemoteFont>('library/', {
      method: 'POST',
      body: form,
    })
    urls.set(created.id, created.fontUrl)
    // Already in hand, so save the round trip on first use.
    downloads.set(created.id, Promise.resolve(input.bytes))
    return toEntry(created)
  },

  async remove(id: string): Promise<void> {
    await request(`library/${id}/`, { method: 'DELETE' })
    downloads.delete(id)
    urls.delete(id)
  },
}
