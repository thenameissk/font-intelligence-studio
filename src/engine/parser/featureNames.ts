/** Human-readable names for the OpenType feature tags we surface. */
export const FEATURE_NAMES: Record<string, string> = {
  aalt: 'Access All Alternates', abvf: 'Above-base Forms', abvm: 'Above-base Mark Positioning',
  abvs: 'Above-base Substitutions', afrc: 'Alternative Fractions', akhn: 'Akhand',
  blwf: 'Below-base Forms', blwm: 'Below-base Mark Positioning', blws: 'Below-base Substitutions',
  calt: 'Contextual Alternates', case: 'Case-Sensitive Forms', ccmp: 'Glyph Composition / Decomposition',
  cfar: 'Conjunct Form After Ro', cjct: 'Conjunct Forms', clig: 'Contextual Ligatures',
  cpct: 'Centered CJK Punctuation', cpsp: 'Capital Spacing', cswh: 'Contextual Swash',
  curs: 'Cursive Positioning', dlig: 'Discretionary Ligatures', dnom: 'Denominators',
  dtls: 'Dotless Forms', expt: 'Expert Forms', falt: 'Final Glyph on Line Alternates',
  fin2: 'Terminal Forms #2', fin3: 'Terminal Forms #3', fina: 'Terminal Forms',
  flac: 'Flattened Accent Forms', frac: 'Fractions', fwid: 'Full Widths',
  half: 'Half Forms', haln: 'Halant Forms', halt: 'Alternate Half Widths',
  hist: 'Historical Forms', hkna: 'Horizontal Kana Alternates', hlig: 'Historical Ligatures',
  hngl: 'Hangul', hojo: 'Hojo Kanji Forms', hwid: 'Half Widths',
  init: 'Initial Forms', isol: 'Isolated Forms', ital: 'Italics',
  jalt: 'Justification Alternates', jp04: 'JIS2004 Forms', jp78: 'JIS78 Forms',
  jp83: 'JIS83 Forms', jp90: 'JIS90 Forms', kern: 'Kerning',
  lfbd: 'Left Bounds', liga: 'Standard Ligatures', ljmo: 'Leading Jamo Forms',
  lnum: 'Lining Figures', locl: 'Localized Forms', ltra: 'Left-to-right Alternates',
  ltrm: 'Left-to-right Mirrored Forms', mark: 'Mark Positioning', med2: 'Medial Forms #2',
  medi: 'Medial Forms', mgrk: 'Mathematical Greek', mkmk: 'Mark to Mark Positioning',
  nalt: 'Alternate Annotation Forms', nlck: 'NLC Kanji Forms', nukt: 'Nukta Forms',
  numr: 'Numerators', onum: 'Oldstyle Figures', opbd: 'Optical Bounds',
  ordn: 'Ordinals', ornm: 'Ornaments', palt: 'Proportional Alternate Widths',
  pcap: 'Petite Capitals', pkna: 'Proportional Kana', pnum: 'Proportional Figures',
  pref: 'Pre-base Forms', pres: 'Pre-base Substitutions', pstf: 'Post-base Forms',
  psts: 'Post-base Substitutions', pwid: 'Proportional Widths', qwid: 'Quarter Widths',
  rand: 'Randomize', rclt: 'Required Contextual Alternates', rkrf: 'Rakar Forms',
  rlig: 'Required Ligatures', rphf: 'Reph Form', rtbd: 'Right Bounds',
  rtla: 'Right-to-left Alternates', rtlm: 'Right-to-left Mirrored Forms', ruby: 'Ruby Notation Forms',
  rvrn: 'Required Variation Alternates', salt: 'Stylistic Alternates', sinf: 'Scientific Inferiors',
  size: 'Optical Size', smcp: 'Small Capitals', smpl: 'Simplified Forms',
  ssty: 'Math Script Style Alternates', stch: 'Stretching Glyph Decomposition',
  subs: 'Subscript', sups: 'Superscript', swsh: 'Swash', titl: 'Titling',
  tjmo: 'Trailing Jamo Forms', tnam: 'Traditional Name Forms', tnum: 'Tabular Figures',
  trad: 'Traditional Forms', twid: 'Third Widths', unic: 'Unicase',
  valt: 'Alternate Vertical Metrics', vatu: 'Vattu Variants', vert: 'Vertical Alternates',
  vhal: 'Alternate Vertical Half Metrics', vjmo: 'Vowel Jamo Forms', vkna: 'Vertical Kana Alternates',
  vkrn: 'Vertical Kerning', vpal: 'Proportional Alternate Vertical Metrics',
  vrt2: 'Vertical Alternates and Rotation', vrtr: 'Vertical Alternates for Rotation',
  zero: 'Slashed Zero',
}

export function featureName(tag: string): string {
  if (FEATURE_NAMES[tag]) return FEATURE_NAMES[tag]
  if (/^ss\d\d$/.test(tag)) return `Stylistic Set ${tag.slice(2)}`
  if (/^cv\d\d$/.test(tag)) return `Character Variant ${tag.slice(2)}`
  return 'Unknown feature'
}

export const AXIS_NAMES: Record<string, string> = {
  wght: 'Weight',
  wdth: 'Width',
  slnt: 'Slant',
  ital: 'Italic',
  opsz: 'Optical Size',
  GRAD: 'Grade',
  XTRA: 'Counter Width',
  XOPQ: 'Thick Stroke',
  YOPQ: 'Thin Stroke',
  YTLC: 'Lowercase Height',
  YTUC: 'Uppercase Height',
  YTAS: 'Ascender Height',
  YTDE: 'Descender Depth',
  YTFI: 'Figure Height',
}
