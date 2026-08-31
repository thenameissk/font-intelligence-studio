/**
 * Extracts font-level metadata from a parsed opentype.js Font plus the raw
 * sfnt table directory. Everything here is read-only: it never touches the
 * imported bytes.
 */
import type { Font as OTFont } from 'opentype.js'
import type {
  FontContainer,
  FontMetadata,
  FontNameRecords,
  OpenTypeFeature,
  OutlineFormat,
  VariationAxis,
  VariationInstance,
  VerticalMetrics,
} from '@/types/font'
import type { SfntDirectory } from './sfnt'
import { AXIS_NAMES, featureName } from './featureNames'

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function englishName(
  record: Record<string, string> | undefined,
): string | null {
  if (!record) return null
  const value =
    record.en ??
    record['en-US'] ??
    Object.values(record).find((v) => typeof v === 'string' && v.length > 0)
  return value && value.length > 0 ? value : null
}

/**
 * opentype.js 2.x groups name records by platform (`windows`, `macintosh`,
 * `unicode`). Windows records win because they carry the fullest language
 * coverage, falling back through the other platforms.
 */
const NAME_PLATFORMS = ['windows', 'macintosh', 'unicode'] as const

function pickName(font: OTFont, key: string): string | null {
  for (const platform of NAME_PLATFORMS) {
    const table = font.names[platform]
    const value = englishName(table?.[key])
    if (value !== null) return value
  }
  return null
}

export function extractNames(font: OTFont): FontNameRecords {
  return {
    copyright: pickName(font, 'copyright'),
    fontFamily: pickName(font, 'fontFamily'),
    fontSubfamily: pickName(font, 'fontSubfamily'),
    uniqueID: pickName(font, 'uniqueID'),
    fullName: pickName(font, 'fullName'),
    version: pickName(font, 'version'),
    postScriptName: pickName(font, 'postScriptName'),
    trademark: pickName(font, 'trademark'),
    manufacturer: pickName(font, 'manufacturer'),
    designer: pickName(font, 'designer'),
    description: pickName(font, 'description'),
    license: pickName(font, 'license'),
    licenseURL: pickName(font, 'licenseURL'),
    vendorURL: pickName(font, 'manufacturerURL'),
    designerURL: pickName(font, 'designerURL'),
    preferredFamily: pickName(font, 'preferredFamily'),
    preferredSubfamily: pickName(font, 'preferredSubfamily'),
  }
}

export function extractVerticalMetrics(font: OTFont): VerticalMetrics {
  const os2 = (font.tables.os2 ?? {}) as Record<string, unknown>
  const hhea = (font.tables.hhea ?? {}) as Record<string, unknown>
  const post = (font.tables.post ?? {}) as Record<string, unknown>

  return {
    unitsPerEm: font.unitsPerEm,
    ascender: num(hhea.ascender) ?? font.ascender,
    descender: num(hhea.descender) ?? font.descender,
    lineGap: num(hhea.lineGap) ?? 0,
    typoAscender: num(os2.sTypoAscender),
    typoDescender: num(os2.sTypoDescender),
    typoLineGap: num(os2.sTypoLineGap),
    winAscent: num(os2.usWinAscent),
    winDescent: num(os2.usWinDescent),
    capHeight: num(os2.sCapHeight),
    xHeight: num(os2.sxHeight),
    underlinePosition: num(post.underlinePosition),
    underlineThickness: num(post.underlineThickness),
    italicAngle: num(post.italicAngle) ?? 0,
  }
}

const FSTYPE_LABELS: Array<[number, string]> = [
  [0x0002, 'Restricted: no embedding'],
  [0x0004, 'Preview & print embedding'],
  [0x0008, 'Editable embedding'],
]

function decodeEmbedding(fsType: number | null): string {
  if (fsType === null) return 'Unknown'
  if ((fsType & 0x000e) === 0) return 'Installable embedding'
  const label =
    FSTYPE_LABELS.find(([bit]) => (fsType & bit) !== 0)?.[1] ?? 'Unknown'
  const extras: string[] = []
  if (fsType & 0x0100) extras.push('no subsetting')
  if (fsType & 0x0200) extras.push('bitmap embedding only')
  return extras.length > 0 ? `${label} (${extras.join(', ')})` : label
}

interface LangSys {
  featureIndexes?: number[]
  reqFeatureIndex?: number
}

interface ScriptRecord {
  tag?: string
  script?: {
    defaultLangSys?: LangSys
    langSysRecords?: Array<{ tag?: string; langSys?: LangSys }>
  }
}

/**
 * Maps each GSUB/GPOS feature to the scripts that actually reference it.
 * The parsed `features` array is positional -- script tables point at it by
 * index, and the same tag appears once per language system.
 */
function featuresFromLayoutTable(
  table: unknown,
  which: 'GSUB' | 'GPOS',
): OpenTypeFeature[] {
  const parsed = table as
    | { features?: Array<{ tag?: string }>; scripts?: ScriptRecord[] }
    | undefined
  if (!parsed?.features) return []

  const scriptsByFeatureIndex = new Map<number, Set<string>>()
  const note = (index: number, script: string): void => {
    if (index === 0xffff) return
    const set = scriptsByFeatureIndex.get(index) ?? new Set<string>()
    set.add(script)
    scriptsByFeatureIndex.set(index, set)
  }
  for (const record of parsed.scripts ?? []) {
    const scriptTag = (record.tag ?? 'DFLT').trim() || 'DFLT'
    const langSystems: Array<LangSys | undefined> = [
      record.script?.defaultLangSys,
      ...(record.script?.langSysRecords ?? []).map((r) => r.langSys),
    ]
    for (const langSys of langSystems) {
      if (!langSys) continue
      for (const index of langSys.featureIndexes ?? []) note(index, scriptTag)
      if (typeof langSys.reqFeatureIndex === 'number') {
        note(langSys.reqFeatureIndex, scriptTag)
      }
    }
  }

  const byTag = new Map<string, OpenTypeFeature>()
  parsed.features.forEach((entry, index) => {
    const tag = entry?.tag
    if (typeof tag !== 'string') return
    const scripts = scriptsByFeatureIndex.get(index) ?? new Set(['DFLT'])
    const existing = byTag.get(tag)
    if (existing) {
      for (const script of scripts) {
        if (!existing.scripts.includes(script)) existing.scripts.push(script)
      }
      return
    }
    byTag.set(tag, {
      tag,
      table: which,
      scripts: [...scripts].sort(),
      description: featureName(tag),
    })
  })
  return [...byTag.values()]
}

export function extractFeatures(font: OTFont): OpenTypeFeature[] {
  return [
    ...featuresFromLayoutTable(font.tables.gsub, 'GSUB'),
    ...featuresFromLayoutTable(font.tables.gpos, 'GPOS'),
  ].sort((a, b) => a.tag.localeCompare(b.tag) || a.table.localeCompare(b.table))
}

export function extractAxes(font: OTFont): VariationAxis[] {
  const fvar = font.tables.fvar
  if (!fvar?.axes) return []
  return fvar.axes.map((axis) => ({
    tag: axis.tag,
    name:
      englishName(axis.name) ?? AXIS_NAMES[axis.tag] ?? axis.tag.toUpperCase(),
    minValue: axis.minValue,
    defaultValue: axis.defaultValue,
    maxValue: axis.maxValue,
  }))
}

export function extractInstances(font: OTFont): VariationInstance[] {
  const fvar = font.tables.fvar
  if (!fvar?.instances) return []
  return fvar.instances.map((instance, i) => ({
    name: englishName(instance.name) ?? `Instance ${i + 1}`,
    coordinates: { ...instance.coordinates },
  }))
}

function outlineFormat(directory: SfntDirectory): OutlineFormat {
  const tags = new Set(directory.tables.map((t) => t.tag))
  if (tags.has('CFF2')) return 'cff2'
  if (tags.has('CFF ')) return 'cff'
  return 'truetype'
}

export function countMappedCodepoints(font: OTFont): number {
  const map = font.tables.cmap?.glyphIndexMap
  return map ? Object.keys(map).length : 0
}

export function extractMetadata(
  font: OTFont,
  directory: SfntDirectory,
  options: {
    container: FontContainer
    fileName: string
    fileSize: number
  },
): FontMetadata {
  const os2 = (font.tables.os2 ?? {}) as Record<string, unknown>
  const fsSelection = num(os2.fsSelection) ?? 0
  const axes = extractAxes(font)
  const tags = new Set(directory.tables.map((t) => t.tag.trim()))

  return {
    names: extractNames(font),
    weightClass: num(os2.usWeightClass),
    widthClass: num(os2.usWidthClass),
    isItalic: (fsSelection & 0x01) !== 0,
    isBold: (fsSelection & 0x20) !== 0,
    embeddingPermission: decodeEmbedding(num(os2.fsType)),
    container: options.container,
    outlineFormat: outlineFormat(directory),
    fileSize: options.fileSize,
    fileName: options.fileName,
    numGlyphs: font.numGlyphs,
    tables: directory.tables.map((t) => ({
      tag: t.tag,
      offset: t.offset,
      length: t.length,
      checksum: t.checksum,
    })),
    features: extractFeatures(font),
    axes,
    instances: extractInstances(font),
    isVariable: axes.length > 0,
    hasKerning: tags.has('kern') || tags.has('GPOS'),
    mappedCodepoints: countMappedCodepoints(font),
  }
}

export function displayFamilyName(metadata: FontMetadata): string {
  return (
    metadata.names.preferredFamily ??
    metadata.names.fontFamily ??
    metadata.names.fullName ??
    metadata.fileName.replace(/\.[^.]+$/, '')
  )
}

export function displayStyleName(metadata: FontMetadata): string {
  return (
    metadata.names.preferredSubfamily ??
    metadata.names.fontSubfamily ??
    'Regular'
  )
}
