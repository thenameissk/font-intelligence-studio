/**
 * Glyph relationships.
 *
 * Type design is systematic: the bowl of 'b' is the bowl of 'd' reversed,
 * 'O' sets the shape of 'C', 'G' and 'Q', and 'n' sets 'h', 'm' and 'u'.
 * When one of a family changes, its relatives usually need the same change.
 *
 * Relationships are declared by character, then resolved to glyph indices
 * against the font actually loaded, so a font missing 'Q' simply has fewer
 * relatives rather than a broken group.
 */

export const RELATION = {
  /** Shares a skeleton: changing one usually means changing the other. */
  Shape: 'shape',
  /** One is built from the other plus marks. */
  Derived: 'derived',
  /** Same construction principle, looser link. */
  Family: 'family',
} as const
export type RelationKind = (typeof RELATION)[keyof typeof RELATION]

export interface RelationshipGroup {
  id: string
  label: string
  kind: RelationKind
  members: string[]
  reason: string
}

/**
 * The core Latin relationship groups. These are design conventions, not
 * facts about a particular font, so they are stated once and intersected
 * with the font's coverage at lookup time.
 */
export const RELATIONSHIP_GROUPS: RelationshipGroup[] = [
  {
    id: 'round-caps',
    label: 'Round capitals',
    kind: RELATION.Shape,
    members: ['O', 'C', 'G', 'Q', '0'],
    reason: 'All share the round capital skeleton set by O',
  },
  {
    id: 'bowl-caps',
    label: 'Capital bowls',
    kind: RELATION.Shape,
    members: ['P', 'R', 'B'],
    reason: 'Share the same bowl attached to a stem',
  },
  {
    id: 'diagonal-caps',
    label: 'Diagonal capitals',
    kind: RELATION.Shape,
    members: ['V', 'W', 'Y', 'X', 'A'],
    reason: 'Built from the same diagonal stroke pair',
  },
  {
    id: 'round-lower',
    label: 'Round lowercase',
    kind: RELATION.Shape,
    members: ['o', 'c', 'e', 'a', 'd', 'b', 'p', 'q', 'g'],
    reason: 'All derive from the lowercase o bowl',
  },
  {
    id: 'arch-lower',
    label: 'Arched lowercase',
    kind: RELATION.Shape,
    members: ['n', 'h', 'm', 'u', 'r'],
    reason: 'Share the shoulder and arch of n',
  },
  {
    id: 'stems',
    label: 'Plain stems',
    kind: RELATION.Shape,
    members: ['i', 'l', 'I', 'j'],
    reason: 'Single vertical stems that must match in weight',
  },
  {
    id: 'e-family',
    label: 'Horizontal-bar lowercase',
    kind: RELATION.Family,
    members: ['e', 'f', 't', 'z'],
    reason: 'Share crossbar height and weight',
  },
  {
    id: 'figures',
    label: 'Figures',
    kind: RELATION.Family,
    members: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    reason: 'Must share height, weight and (usually) width',
  },
  {
    id: 'quotes',
    label: 'Quotes and apostrophes',
    kind: RELATION.Family,
    members: ['‘', '’', '“', '”', "'", '"'],
    reason: 'Share the same mark shape at different scales',
  },
  {
    id: 'brackets',
    label: 'Brackets',
    kind: RELATION.Family,
    members: ['(', ')', '[', ']', '{', '}'],
    reason: 'Share vertical extent and weight',
  },
  {
    id: 'dashes',
    label: 'Dashes',
    kind: RELATION.Family,
    members: ['-', '–', '—', '−'],
    reason: 'Share thickness and vertical position',
  },
]

/**
 * Accented glyphs derived from a base letter. Used to warn that changing a
 * base letter leaves its accented relatives inconsistent.
 */
export const DERIVED_BASES: Record<string, string[]> = {
  A: ['À', 'Á', 'Â', 'Ã', 'Ä', 'Å', 'Ā', 'Ă', 'Ą'],
  C: ['Ç', 'Ć', 'Ĉ', 'Ċ', 'Č'],
  E: ['È', 'É', 'Ê', 'Ë', 'Ē', 'Ĕ', 'Ė', 'Ę', 'Ě'],
  I: ['Ì', 'Í', 'Î', 'Ï', 'Ĩ', 'Ī', 'Į', 'İ'],
  N: ['Ñ', 'Ń', 'Ņ', 'Ň'],
  O: ['Ò', 'Ó', 'Ô', 'Õ', 'Ö', 'Ø', 'Ō', 'Ŏ', 'Ő'],
  U: ['Ù', 'Ú', 'Û', 'Ü', 'Ũ', 'Ū', 'Ŭ', 'Ů', 'Ű', 'Ų'],
  Y: ['Ý', 'Ÿ', 'Ŷ'],
  S: ['Ś', 'Ŝ', 'Ş', 'Š'],
  Z: ['Ź', 'Ż', 'Ž'],
  a: ['à', 'á', 'â', 'ã', 'ä', 'å', 'ā', 'ă', 'ą'],
  c: ['ç', 'ć', 'ĉ', 'ċ', 'č'],
  e: ['è', 'é', 'ê', 'ë', 'ē', 'ĕ', 'ė', 'ę', 'ě'],
  i: ['ì', 'í', 'î', 'ï', 'ĩ', 'ī', 'į'],
  n: ['ñ', 'ń', 'ņ', 'ň'],
  o: ['ò', 'ó', 'ô', 'õ', 'ö', 'ø', 'ō', 'ŏ', 'ő'],
  u: ['ù', 'ú', 'û', 'ü', 'ũ', 'ū', 'ŭ', 'ů', 'ű', 'ų'],
  y: ['ý', 'ÿ', 'ŷ'],
  s: ['ś', 'ŝ', 'ş', 'š'],
  z: ['ź', 'ż', 'ž'],
}

export interface RelatedGlyph {
  char: string
  glyphIndex: number
  kind: RelationKind
  group: string
  reason: string
}

export interface RelationshipLookup {
  charToIndex: (char: string) => number | null
  indexToChar: (index: number) => string | null
}

/**
 * Finds the glyphs related to `glyphIndex` that this font actually contains.
 * The glyph itself is never included in its own relatives.
 */
export function findRelatedGlyphs(
  glyphIndex: number,
  lookup: RelationshipLookup,
): RelatedGlyph[] {
  const char = lookup.indexToChar(glyphIndex)
  if (char === null) return []

  const found = new Map<number, RelatedGlyph>()

  for (const group of RELATIONSHIP_GROUPS) {
    if (!group.members.includes(char)) continue
    for (const member of group.members) {
      if (member === char) continue
      const index = lookup.charToIndex(member)
      if (index === null || index === glyphIndex) continue
      if (found.has(index)) continue
      found.set(index, {
        char: member,
        glyphIndex: index,
        kind: group.kind,
        group: group.label,
        reason: group.reason,
      })
    }
  }

  for (const derived of DERIVED_BASES[char] ?? []) {
    const index = lookup.charToIndex(derived)
    if (index === null || index === glyphIndex || found.has(index)) continue
    found.set(index, {
      char: derived,
      glyphIndex: index,
      kind: RELATION.Derived,
      group: 'Accented forms',
      reason: `Built from ${char}`,
    })
  }

  // A glyph is also related to the base it derives from.
  for (const [base, derivedList] of Object.entries(DERIVED_BASES)) {
    if (!derivedList.includes(char)) continue
    const index = lookup.charToIndex(base)
    if (index === null || index === glyphIndex || found.has(index)) continue
    found.set(index, {
      char: base,
      glyphIndex: index,
      kind: RELATION.Derived,
      group: 'Base letter',
      reason: `${char} is built from ${base}`,
    })
  }

  // Sorted by code point rather than locale, so the order is the same on
  // every machine and matches the glyph browser.
  return [...found.values()].sort(
    (a, b) => (a.char.codePointAt(0) ?? 0) - (b.char.codePointAt(0) ?? 0),
  )
}

/** Every group this font has at least two members of, for the QA engine. */
export function availableGroups(
  lookup: RelationshipLookup,
): Array<{ group: RelationshipGroup; indices: number[] }> {
  return RELATIONSHIP_GROUPS.map((group) => ({
    group,
    indices: group.members
      .map((member) => lookup.charToIndex(member))
      .filter((index): index is number => index !== null),
  })).filter((entry) => entry.indices.length >= 2)
}
