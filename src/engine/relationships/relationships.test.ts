import { describe, expect, it } from 'vitest'
import {
  availableGroups,
  findRelatedGlyphs,
  type RelationshipLookup,
} from './relationships'

/** A pretend font containing exactly the characters listed. */
function lookupFor(chars: string): RelationshipLookup {
  const list = [...chars]
  return {
    charToIndex: (char) => {
      const index = list.indexOf(char)
      return index === -1 ? null : index + 1
    },
    indexToChar: (index) => list[index - 1] ?? null,
  }
}

describe('findRelatedGlyphs', () => {
  it('relates O to the other round capitals present', () => {
    const lookup = lookupFor('OCGQ0X')
    const related = findRelatedGlyphs(lookup.charToIndex('O')!, lookup)
    expect(related.map((r) => r.char).sort()).toEqual(['0', 'C', 'G', 'Q'])
  })

  it('never includes the glyph itself', () => {
    const lookup = lookupFor('OCGQ0')
    const index = lookup.charToIndex('O')!
    const related = findRelatedGlyphs(index, lookup)
    expect(related.some((r) => r.glyphIndex === index)).toBe(false)
  })

  it('only reports relatives the font actually has', () => {
    const lookup = lookupFor('OC')
    const related = findRelatedGlyphs(lookup.charToIndex('O')!, lookup)
    expect(related.map((r) => r.char)).toEqual(['C'])
  })

  it('links a base letter to its accented forms', () => {
    const lookup = lookupFor('AÀÁÂ')
    const related = findRelatedGlyphs(lookup.charToIndex('A')!, lookup)
    expect(related.map((r) => r.char)).toEqual(['À', 'Á', 'Â'])
    expect(related.every((r) => r.kind === 'derived')).toBe(true)
  })

  it('links an accented form back to its base', () => {
    const lookup = lookupFor('AÀ')
    const related = findRelatedGlyphs(lookup.charToIndex('À')!, lookup)
    expect(related.map((r) => r.char)).toEqual(['A'])
  })

  it('relates n to the other arched lowercase letters', () => {
    const lookup = lookupFor('nhmur')
    const related = findRelatedGlyphs(lookup.charToIndex('n')!, lookup)
    expect(related.map((r) => r.char).sort()).toEqual(['h', 'm', 'r', 'u'])
  })

  it('returns nothing for an unrelated glyph', () => {
    const lookup = lookupFor('§O')
    expect(findRelatedGlyphs(lookup.charToIndex('§')!, lookup)).toEqual([])
  })

  it('de-duplicates a glyph that appears in several groups', () => {
    // '0' is both a round capital relative and a figure.
    const lookup = lookupFor('O0123456789')
    const related = findRelatedGlyphs(lookup.charToIndex('0')!, lookup)
    const indices = related.map((r) => r.glyphIndex)
    expect(new Set(indices).size).toBe(indices.length)
  })
})

describe('availableGroups', () => {
  it('skips groups the font barely covers', () => {
    const groups = availableGroups(lookupFor('OC'))
    expect(groups.map((g) => g.group.id)).toEqual(['round-caps'])
  })

  it('finds several groups in a fuller font', () => {
    const groups = availableGroups(lookupFor('OCGQ0PRBnhmuil'))
    expect(groups.map((g) => g.group.id)).toContain('arch-lower')
    expect(groups.map((g) => g.group.id)).toContain('bowl-caps')
  })
})
