import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { layoutText } from './layout'
import { collectPairs, effectiveKerning, originalKerning, pairKey } from './kerning'

const FONT = resolve(__dirname, '../../../test-fonts/ArialBlack.ttf')
const describeIf = existsSync(FONT) ? describe : describe.skip

let cached: ParsedFont | null = null
async function loadFont(): Promise<ParsedFont> {
  if (cached) return cached
  const bytes = readFileSync(FONT)
  cached = await parseFontFile({
    name: 'ArialBlack.ttf',
    buffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  })
  return cached
}

/**
 * Arial Black keeps its kerning in GPOS and ships no `kern` table at all.
 * That combination used to read as "this font has no kerning": every pair
 * in the editor showed 0 and running text was set unkerned, because
 * `getKerningValue` resolves GPOS by guessing a script tag and misses.
 */
describeIf('kerning from a GPOS-only font', () => {
  it('reads the pairs the font actually carries', async () => {
    const parsed = await loadFont()
    const a = parsed.cmap.get(0x41)!
    const v = parsed.cmap.get(0x56)!

    expect(originalKerning(parsed, a, v)).toBe(-113)
  })

  it('reports zero for a pair the font does not kern', async () => {
    const parsed = await loadFont()
    const h = parsed.cmap.get(0x48)!
    const n = parsed.cmap.get(0x6e)!

    expect(originalKerning(parsed, h, n)).toBe(0)
  })

  it('surfaces kerned pairs in the editor list', async () => {
    const parsed = await loadFont()
    const pairs = collectPairs(parsed, {}, { onlyKerned: true })

    expect(pairs.length).toBeGreaterThan(20)
    const av = pairs.find((p) => p.leftChar === 'A' && p.rightChar === 'V')
    expect(av?.current).toBe(-113)
  })

  it('lets an override win over the font', async () => {
    const parsed = await loadFont()
    const a = parsed.cmap.get(0x41)!
    const v = parsed.cmap.get(0x56)!
    const edits = { [pairKey(a, v)]: -300 }

    expect(effectiveKerning(parsed, edits, a, v)).toBe(-300)
    expect(originalKerning(parsed, a, v)).toBe(-113)
  })

  it('tightens running text, so the preview and the pair list agree', async () => {
    const parsed = await loadFont()
    const kerned = layoutText(parsed, {}, {}, 'AV', { kerning: true })
    const flat = layoutText(parsed, {}, {}, 'AV', { kerning: false })

    expect(flat.width - kerned.width).toBe(113)
  })
})
