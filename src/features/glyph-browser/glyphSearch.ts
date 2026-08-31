/**
 * Glyph browser filtering.
 *
 * Search matches a literal character, a glyph name, a code point written in
 * several common ways, or a category name -- so "0041", "U+41", "A" and
 * "uppercase" all find the same glyph.
 */
import {
  CATEGORY_LABELS,
  type GlyphCategory,
  type GlyphIndexEntry,
} from '@/types/font'

export interface MissingGlyphEntry {
  codepoint: number
  char: string | null
  category: GlyphCategory
}

function parseCodepointQuery(query: string): number | null {
  const trimmed = query.trim().toLowerCase()
  const hex = trimmed.replace(/^(u\+|0x|\\u)/, '')
  if (/^[0-9a-f]{2,6}$/.test(hex)) {
    const value = Number.parseInt(hex, 16)
    if (Number.isFinite(value)) return value
  }
  return null
}

export function matchesQuery(
  entry: GlyphIndexEntry,
  query: string,
  codepointQuery: number | null,
): boolean {
  if (query.length === 0) return true
  const lower = query.toLowerCase()

  if (entry.name.toLowerCase().includes(lower)) return true
  if (entry.char !== null && entry.char === query) return true
  if (
    entry.unicode !== null &&
    (entry.unicode === codepointQuery ||
      entry.unicode.toString(16).padStart(4, '0').includes(lower))
  ) {
    return true
  }
  if (CATEGORY_LABELS[entry.category].toLowerCase().includes(lower)) return true
  return false
}

export function filterGlyphs(
  index: readonly GlyphIndexEntry[],
  options: {
    query: string
    category: GlyphCategory | 'all'
    hideEmpty: boolean
  },
): GlyphIndexEntry[] {
  const codepointQuery = parseCodepointQuery(options.query)
  const query = options.query.trim()

  return index.filter((entry) => {
    if (options.category !== 'all' && entry.category !== options.category) {
      return false
    }
    if (options.hideEmpty && entry.isEmpty && entry.unicode === null) {
      return false
    }
    return matchesQuery(entry, query, codepointQuery)
  })
}

/** Counts per category, for the filter chips. */
export function countByCategory(
  index: readonly GlyphIndexEntry[],
): Map<GlyphCategory, number> {
  const counts = new Map<GlyphCategory, number>()
  for (const entry of index) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
  }
  return counts
}
