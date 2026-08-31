import type { Outline, GlyphComponent, Rect } from './geometry'

export const FONT_CONTAINER = {
  SFNT: 'sfnt',
  WOFF: 'woff',
  WOFF2: 'woff2',
  Collection: 'ttc',
} as const
export type FontContainer =
  (typeof FONT_CONTAINER)[keyof typeof FONT_CONTAINER]

export const OUTLINE_FORMAT = {
  TrueType: 'truetype',
  CFF: 'cff',
  CFF2: 'cff2',
} as const
export type OutlineFormat =
  (typeof OUTLINE_FORMAT)[keyof typeof OUTLINE_FORMAT]

export interface VerticalMetrics {
  unitsPerEm: number
  ascender: number
  descender: number
  lineGap: number
  /** typo* / win* from OS/2, when present. */
  typoAscender: number | null
  typoDescender: number | null
  typoLineGap: number | null
  winAscent: number | null
  winDescent: number | null
  capHeight: number | null
  xHeight: number | null
  underlinePosition: number | null
  underlineThickness: number | null
  italicAngle: number
}

export interface VariationAxis {
  tag: string
  name: string
  minValue: number
  defaultValue: number
  maxValue: number
}

export interface VariationInstance {
  name: string
  coordinates: Record<string, number>
}

export interface OpenTypeFeature {
  tag: string
  /** 'GSUB' | 'GPOS' */
  table: 'GSUB' | 'GPOS'
  scripts: string[]
  description: string
}

export interface FontNameRecords {
  copyright: string | null
  fontFamily: string | null
  fontSubfamily: string | null
  uniqueID: string | null
  fullName: string | null
  version: string | null
  postScriptName: string | null
  trademark: string | null
  manufacturer: string | null
  designer: string | null
  description: string | null
  license: string | null
  licenseURL: string | null
  vendorURL: string | null
  designerURL: string | null
  preferredFamily: string | null
  preferredSubfamily: string | null
}

export interface FontMetadata {
  names: FontNameRecords
  /** OS/2 usWeightClass (100-1000), null when the table is absent. */
  weightClass: number | null
  /** OS/2 usWidthClass (1-9). */
  widthClass: number | null
  /** OS/2 fsSelection bits, decoded. */
  isItalic: boolean
  isBold: boolean
  /** OS/2 fsType embedding permissions, decoded to a human string. */
  embeddingPermission: string
  container: FontContainer
  outlineFormat: OutlineFormat
  /** Byte length of the imported file. */
  fileSize: number
  fileName: string
  numGlyphs: number
  tables: TableRecord[]
  features: OpenTypeFeature[]
  axes: VariationAxis[]
  instances: VariationInstance[]
  isVariable: boolean
  hasKerning: boolean
  /** Number of distinct Unicode code points mapped by cmap. */
  mappedCodepoints: number
}

export interface TableRecord {
  tag: string
  offset: number
  length: number
  checksum: number
}

/**
 * Read-only description of a glyph as it exists in the imported font.
 * Outlines are decoded lazily; `outline` is populated on demand by the
 * FontModel cache and is never mutated in place.
 */
export interface SourceGlyph {
  index: number
  name: string
  /** Primary code point, or null for unencoded glyphs. */
  unicode: number | null
  /** Every code point that maps to this glyph. */
  unicodes: number[]
  advanceWidth: number
  leftSideBearing: number
  /** True for TrueType composite glyphs referencing other glyphs. */
  isComposite: boolean
}

/**
 * The editable state layered on top of a SourceGlyph.
 *
 * Only fields the user actually changed are present, which keeps projects
 * small and makes "revert glyph" a deletion. Side bearings are derived from
 * the outline rather than stored: setting an LSB translates the outline,
 * setting an RSB changes the advance width, exactly as in other editors.
 */
export interface GlyphEdit {
  outline?: Outline
  advanceWidth?: number
}

/** Sparse overlay of edits, keyed by glyph index. */
export type GlyphEdits = Readonly<Record<number, GlyphEdit>>

/** A fully resolved glyph: source data with any edits applied. */
export interface ResolvedGlyph {
  index: number
  name: string
  unicode: number | null
  unicodes: number[]
  advanceWidth: number
  outline: Outline
  /** Component references from the source font; empty once edited. */
  components: GlyphComponent[]
  bounds: Rect
  /** Derived from geometry: bounds.xMin. */
  leftSideBearing: number
  /** Derived from geometry: advanceWidth - bounds.xMax. */
  rightSideBearing: number
  isComposite: boolean
  isEmpty: boolean
  modified: boolean
}

export interface KerningPair {
  left: number
  right: number
  value: number
}

export const GLYPH_CATEGORY = {
  Uppercase: 'uppercase',
  Lowercase: 'lowercase',
  Numbers: 'numbers',
  Punctuation: 'punctuation',
  Symbols: 'symbols',
  Currency: 'currency',
  Mathematical: 'mathematical',
  Arrows: 'arrows',
  LatinExtended: 'latin-extended',
  Greek: 'greek',
  Cyrillic: 'cyrillic',
  Marks: 'marks',
  Other: 'other',
  Unencoded: 'unencoded',
} as const
export type GlyphCategory =
  (typeof GLYPH_CATEGORY)[keyof typeof GLYPH_CATEGORY]

export const CATEGORY_LABELS: Record<GlyphCategory, string> = {
  uppercase: 'Uppercase',
  lowercase: 'Lowercase',
  numbers: 'Numbers',
  punctuation: 'Punctuation',
  symbols: 'Symbols',
  currency: 'Currency',
  mathematical: 'Mathematical',
  arrows: 'Arrows',
  'latin-extended': 'Latin Extended',
  greek: 'Greek',
  cyrillic: 'Cyrillic',
  marks: 'Marks',
  other: 'Other Unicode',
  unencoded: 'Unencoded',
}

export const CATEGORY_ORDER: GlyphCategory[] = [
  'uppercase',
  'lowercase',
  'numbers',
  'punctuation',
  'symbols',
  'currency',
  'mathematical',
  'arrows',
  'latin-extended',
  'greek',
  'cyrillic',
  'marks',
  'other',
  'unencoded',
]

/** Index entry used by the (virtualized) glyph browser. */
export interface GlyphIndexEntry {
  index: number
  name: string
  unicode: number | null
  category: GlyphCategory
  /** The character to display, when the glyph is encoded and printable. */
  char: string | null
  isEmpty: boolean
}

export interface ImportWarning {
  severity: 'info' | 'warning' | 'error'
  message: string
  detail?: string
}
