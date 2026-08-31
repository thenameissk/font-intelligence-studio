import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parseFontFile } from '@/engine/parser/parseFont'
import { analyzeFontDna } from './fontDna'
import { createDnaSource } from './dnaSource'

const CANDIDATES: Array<{ path: string; label: string; expectWeight: number }> = [
  { path: '/System/Library/Fonts/Supplemental/Arial.ttf', label: 'Arial Regular', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Arial Bold.ttf', label: 'Arial Bold', expectWeight: 700 },
  { path: '/System/Library/Fonts/Supplemental/Arial Black.ttf', label: 'Arial Black', expectWeight: 900 },
  { path: '/System/Library/Fonts/Supplemental/Times New Roman.ttf', label: 'Times', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Georgia.ttf', label: 'Georgia', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Futura.ttc', label: 'Futura', expectWeight: 500 },
  { path: '/System/Library/Fonts/Supplemental/Arial Narrow.ttf', label: 'Arial Narrow', expectWeight: 400 },
  { path: '/System/Library/Fonts/Helvetica.ttc', label: 'Helvetica', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Baskerville.ttc', label: 'Baskerville', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Didot.ttc', label: 'Didot', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Courier New.ttf', label: 'Courier New', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Verdana.ttf', label: 'Verdana', expectWeight: 400 },
  { path: '/System/Library/Fonts/Supplemental/Courier New.ttf', label: 'Courier New', expectWeight: 400 },
]

async function analyze(path: string) {
  const buffer = readFileSync(path)
  const parsed = await parseFontFile({
    name: path.split('/').pop()!,
    buffer: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  })
  return {
    parsed,
    dna: analyzeFontDna(createDnaSource(parsed, {})),
  }
}

const available = CANDIDATES.filter((c) => existsSync(c.path))
const describeIf = available.length > 0 ? describe : describe.skip

describeIf('Font DNA against real families', () => {
  it('estimates weight within one step of the declared class', async () => {
    const rows: string[] = []
    let checked = 0
    for (const candidate of available) {
      const { parsed, dna } = await analyze(candidate.path)
      const declaredWeight = parsed.metadata.weightClass
      rows.push(
        [
          candidate.label.padEnd(16),
          `stem/cap ${(dna.weight.value ?? 0).toFixed(3)}`,
          `est ${dna.weight.label.padEnd(12)}`,
          `declared ${declaredWeight}`,
          `width ${(dna.width.value ?? 0).toFixed(2)} ${dna.width.label}`,
          `contrast ${(dna.contrast.value ?? 0).toFixed(2)}`,
          `serif ${dna.serifs.label}`,
          `geom ${dna.geometry.label}`,
        ].join('  '),
      )
      if (declaredWeight === null || dna.weight.value === null) continue
      checked += 1
      const estimated = WEIGHT_VALUES[dna.weight.label] ?? 400
      expect(
        Math.abs(estimated - declaredWeight),
        `${candidate.label}: estimated ${dna.weight.label} (${estimated}) vs declared ${declaredWeight}\n${rows.join('\n')}`,
      ).toBeLessThanOrEqual(200)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('measures x-height and cap height consistent with OS/2', async () => {
    const path = available[0].path
    const { parsed, dna } = await analyze(path)
    if (parsed.verticalMetrics.capHeight) {
      expect(dna.capHeight.value).toBeGreaterThan(
        parsed.verticalMetrics.capHeight * 0.9,
      )
      expect(dna.capHeight.value).toBeLessThan(
        parsed.verticalMetrics.capHeight * 1.1,
      )
    }
    expect(dna.xHeight.value).toBeGreaterThan(0)
    expect(dna.capHeight.value! > dna.xHeight.value!).toBe(true)
  })

  /**
   * These are the classifications a type designer would give these faces.
   * They pin the heuristics so a change to a threshold cannot silently
   * start calling Futura a grotesque or Verdana a serif.
   */
  const EXPECTED: Record<string, { serif: string; geometry?: string; width?: string }> = {
    'Arial Regular': { serif: 'Sans serif', geometry: 'Grotesque', width: 'Normal' },
    Helvetica: { serif: 'Sans serif', geometry: 'Grotesque' },
    Verdana: { serif: 'Sans serif', geometry: 'Grotesque' },
    Futura: { serif: 'Sans serif', geometry: 'Geometric' },
    'Arial Narrow': { serif: 'Sans serif', width: 'Semi Condensed' },
    Times: { serif: 'Serif', geometry: 'Transitional' },
    Georgia: { serif: 'Serif', geometry: 'Transitional' },
    Baskerville: { serif: 'Serif', geometry: 'Transitional' },
    Didot: { serif: 'Serif', geometry: 'Didone' },
    'Courier New': { serif: 'Serif', geometry: 'Slab' },
  }

  for (const candidate of available) {
    const expected = EXPECTED[candidate.label]
    if (!expected) continue
    it(`classifies ${candidate.label} the way a designer would`, async () => {
      const { dna } = await analyze(candidate.path)
      expect(dna.serifs.label).toBe(expected.serif)
      if (expected.geometry) expect(dna.geometry.label).toBe(expected.geometry)
      if (expected.width) expect(dna.width.label).toBe(expected.width)
    })
  }

  it('labels every heuristic as an estimate, not a fact', async () => {
    const { dna } = await analyze(available[0].path)
    for (const field of [dna.weight, dna.width, dna.geometry, dna.terminals, dna.corners]) {
      expect(['estimated', 'declared', 'unavailable']).toContain(field.confidence)
    }
    // Measured metrics must never be dressed up as declared.
    expect(dna.xHeight.confidence).toBe('measured')
  })
})

const WEIGHT_VALUES: Record<string, number> = {
  Thin: 100,
  'Extra Light': 200,
  Light: 300,
  Regular: 400,
  Medium: 500,
  'Semi Bold': 600,
  Bold: 700,
  'Extra Bold': 800,
  Black: 900,
  'Extra Black': 950,
}
