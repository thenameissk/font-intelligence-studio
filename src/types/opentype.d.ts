/**
 * Hand-written declarations for opentype.js 2.x.
 *
 * The DefinitelyTyped package (@types/opentype.js) still describes the 1.3
 * API and disagrees with the shipped 2.0 module in several places, so we
 * declare exactly the surface this project consumes.
 */
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M'; x: number; y: number }
    | { type: 'L'; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'Z' }

  export class Path {
    commands: PathCommand[]
    fill: string | null
    stroke: string | null
    strokeWidth: number
    unitsPerEm?: number
    constructor()
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void
    quadTo(x1: number, y1: number, x: number, y: number): void
    close(): void
    closePath(): void
    extend(pathOrCommands: Path | PathCommand[]): void
    getBoundingBox(): BoundingBox
    toPathData(decimalPlaces?: number): string
    toSVG(decimalPlaces?: number): string
    draw(ctx: CanvasRenderingContext2D): void
  }

  export class BoundingBox {
    x1: number
    y1: number
    x2: number
    y2: number
    isEmpty(): boolean
  }

  export interface GlyphMetrics {
    xMin: number
    yMin: number
    xMax: number
    yMax: number
    leftSideBearing: number
    rightSideBearing: number
  }

  export interface GlyphComponentRef {
    glyphIndex: number
    dx: number
    dy: number
    xScale?: number
    scale01?: number
    scale10?: number
    yScale?: number
    matchedPoints?: number[]
  }

  export class Glyph {
    index: number
    name: string | null
    unicode: number | undefined
    unicodes: number[]
    advanceWidth: number
    leftSideBearing: number
    numberOfContours?: number
    xMin?: number
    yMin?: number
    xMax?: number
    yMax?: number
    components?: GlyphComponentRef[]
    isComposite?: boolean
    path: Path
    constructor(options: {
      name?: string
      unicode?: number
      unicodes?: number[]
      index?: number
      advanceWidth?: number
      leftSideBearing?: number
      path?: Path
    })
    getPath(x?: number, y?: number, fontSize?: number, options?: unknown, font?: Font): Path
    getBoundingBox(): BoundingBox
    getMetrics(): GlyphMetrics
  }

  export interface GlyphSet {
    length: number
    get(index: number): Glyph
    push(index: number, loader: Glyph): void
  }

  export interface FvarAxis {
    tag: string
    minValue: number
    defaultValue: number
    maxValue: number
    name: Record<string, string>
  }

  export interface FvarInstance {
    name: Record<string, string>
    coordinates: Record<string, number>
  }

  export interface FontTables {
    head?: Record<string, number>
    hhea?: Record<string, number>
    maxp?: Record<string, number>
    os2?: Record<string, number | number[] | string>
    post?: Record<string, unknown>
    cmap?: { glyphIndexMap: Record<string, number>; format?: number }
    fvar?: { axes: FvarAxis[]; instances: FvarInstance[] }
    gsub?: { features?: Array<{ tag: string; feature: unknown }>; scripts?: unknown[] }
    gpos?: { features?: Array<{ tag: string; feature: unknown }>; scripts?: unknown[] }
    kern?: Record<string, number>
    cff?: { topDict?: Record<string, unknown> }
    cff2?: unknown
    gvar?: unknown
    avar?: unknown
    hvar?: unknown
    stat?: unknown
    meta?: Record<string, string>
    [tag: string]: unknown
  }

  export type LocalizedName = Record<string, string>

  /** In opentype.js 2.x, name records are bucketed by platform. */
  export type NameTable = Record<string, LocalizedName | undefined>

  export interface FontNames {
    windows?: NameTable
    macintosh?: NameTable
    unicode?: NameTable
  }

  export interface KerningLookup {
    [key: string]: unknown
  }

  export interface Position {
    getKerningTables(script?: string, language?: string): KerningLookup[]
    getKerningValue(
      kerningLookups: KerningLookup[],
      leftIndex: number,
      rightIndex: number,
    ): number
  }

  export interface SingleSubstitution {
    sub: number
    by: number
  }

  export interface AlternateSubstitution {
    sub: number
    by: number[]
  }

  export interface LigatureSubstitution {
    sub: number[]
    by: number
  }

  export interface Substitution {
    getSingle(feature: string, script?: string, language?: string): SingleSubstitution[]
    getAlternates(feature: string, script?: string, language?: string): AlternateSubstitution[]
    getLigatures(feature: string, script?: string, language?: string): LigatureSubstitution[]
    getMultiple(feature: string, script?: string, language?: string): unknown[]
    getFeature(feature: string, script?: string, language?: string): unknown
    getScriptNames(): string[]
    getDefaultScriptName(): string
  }

  export interface VariationManager {
    get(): Record<string, number>
    set(coordinates: Record<string, number>): void
    getDefaultCoordinates(): Record<string, number>
  }

  export class Font {
    constructor(options: {
      familyName: string
      styleName: string
      unitsPerEm: number
      ascender: number
      descender: number
      glyphs: Glyph[]
      [key: string]: unknown
    })
    names: FontNames
    tables: FontTables
    unitsPerEm: number
    ascender: number
    descender: number
    numGlyphs: number
    glyphs: GlyphSet
    outlinesFormat: 'truetype' | 'cff'
    kerningPairs: Record<string, number>
    position: Position
    substitution: Substitution
    variation?: VariationManager
    supported: boolean
    nameToGlyphIndex(name: string): number
    charToGlyphIndex(ch: string): number
    charToGlyph(ch: string): Glyph
    hasChar(ch: string): boolean
    getEnglishName(name: string): string | undefined
    getKerningValue(left: Glyph | number, right: Glyph | number): number
    getAdvanceWidth(text: string, fontSize?: number, options?: unknown): number
    stringToGlyphs(text: string, options?: unknown): Glyph[]
    toTables(): unknown
    toArrayBuffer(): ArrayBuffer
    download(fileName?: string): void
  }

  export function parse(buffer: ArrayBuffer | Uint8Array, opt?: {
    lowMemory?: boolean
    isCFF2?: boolean
    tableIndex?: number
  }): Font
}
