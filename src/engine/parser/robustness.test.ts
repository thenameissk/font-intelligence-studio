/**
 * Regression coverage for fonts that are valid but trip up the parser.
 *
 * These are all real system fonts that failed before the collection
 * extraction and cmap sanitiser were added. They are skipped when the files
 * are not present so the suite still runs on other machines.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFontFile } from './parseFont'

interface Case {
  path: string
  label: string
  /** What made this font hard before. */
  why: string
}

const CASES: Case[] = [
  {
    path: '/System/Library/Fonts/Helvetica.ttc',
    label: 'Helvetica',
    why: 'collection, plus nine Macintosh format 6 cmap subtables',
  },
  {
    path: '/System/Library/Fonts/Supplemental/Didot.ttc',
    label: 'Didot',
    why: 'format 0 cmap listed after the Unicode subtable',
  },
  {
    path: '/System/Library/Fonts/Supplemental/Baskerville.ttc',
    label: 'Baskerville',
    why: 'collection',
  },
  {
    path: '/System/Library/Fonts/Supplemental/Zapfino.ttf',
    label: 'Zapfino',
    why: 'very large glyph set with sparse encoding',
  },
  {
    path: '/System/Library/Fonts/Apple Symbols.ttf',
    label: 'Apple Symbols',
    why: 'symbol font with supplementary-plane coverage',
  },
]

const present = CASES.filter((c) => existsSync(c.path))
const describeIf = present.length > 0 ? describe : describe.skip

describeIf('awkward but valid fonts', () => {
  for (const testCase of present) {
    it(`opens ${testCase.label} (${testCase.why})`, async () => {
      const bytes = readFileSync(testCase.path)
      const parsed = await parseFontFile({
        name: testCase.path.split('/').pop()!,
        buffer: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      })
      expect(parsed.metadata.numGlyphs).toBeGreaterThan(50)
      expect(parsed.metadata.mappedCodepoints).toBeGreaterThan(50)
      expect(parsed.glyphs).toHaveLength(parsed.metadata.numGlyphs)
    })
  }

  // Parsing and byte-comparing a multi-megabyte collection takes several
  // seconds on a loaded machine, which is slow rather than broken; the
  // default five-second limit fails it intermittently.
  it('keeps the exportable bytes identical to the imported file', { timeout: 30_000 }, async () => {
    const path = present[0].path
    const bytes = readFileSync(path)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const parsed = await parseFontFile({ name: 'x', buffer })
    // Sanitising happens on a copy, so the imported bytes are untouched.
    expect(parsed.originalFile.byteLength).toBe(buffer.byteLength)
    expect(new Uint8Array(parsed.originalFile)).toEqual(new Uint8Array(buffer))
  })
})
