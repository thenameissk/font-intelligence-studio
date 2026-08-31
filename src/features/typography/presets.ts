import type { LayoutOptions } from '@/engine/typography/layout'

export interface TypographyPreset {
  id: string
  label: string
  text: string
  fontSize: number
  lineHeight: number
  tracking: number
  align: NonNullable<LayoutOptions['align']>
  /** Column width in pixels; 0 means "fill the pane". */
  columnWidth: number
}

export const PRESETS: TypographyPreset[] = [
  {
    id: 'heading',
    label: 'Heading',
    text: 'Typography is what\nlanguage looks like',
    fontSize: 56,
    lineHeight: 1.08,
    tracking: -20,
    align: 'left',
    columnWidth: 0,
  },
  {
    id: 'paragraph',
    label: 'Paragraph',
    text: 'The quick brown fox jumps over the lazy dog. Typography is the craft of endowing human language with a durable visual form, and thus with an independent existence.',
    fontSize: 17,
    lineHeight: 1.55,
    tracking: 0,
    align: 'left',
    columnWidth: 560,
  },
  {
    id: 'ui',
    label: 'UI',
    text: 'Settings   Preferences   Account\nSave changes   Cancel   Delete',
    fontSize: 13,
    lineHeight: 1.7,
    tracking: 5,
    align: 'left',
    columnWidth: 0,
  },
  {
    id: 'numbers',
    label: 'Numbers',
    text: '0123456789\n1,234,567.89   $2,450   −18%\n2026-08-27   09:41   +44 20 7946',
    fontSize: 22,
    lineHeight: 1.5,
    tracking: 0,
    align: 'left',
    columnWidth: 0,
  },
  {
    id: 'buttons',
    label: 'Buttons',
    text: 'Get started   Learn more   Continue',
    fontSize: 15,
    lineHeight: 1.4,
    tracking: 15,
    align: 'center',
    columnWidth: 0,
  },
  {
    id: 'navigation',
    label: 'Navigation',
    text: 'Home   Products   Pricing   Docs   About',
    fontSize: 14,
    lineHeight: 1.4,
    tracking: 10,
    align: 'left',
    columnWidth: 0,
  },
  {
    id: 'quote',
    label: 'Quote',
    text: '“Perfect typography is a science.\nIt is also the most elusive of all arts.”',
    fontSize: 30,
    lineHeight: 1.35,
    tracking: -8,
    align: 'left',
    columnWidth: 620,
  },
  {
    id: 'editorial',
    label: 'Editorial',
    text: 'Hamburgefonstiv\nThe letters that decide a typeface\n\nA well-made face reveals itself in the fit between shapes, not in any single letter. Set a paragraph, then look at the rhythm.',
    fontSize: 19,
    lineHeight: 1.45,
    tracking: 0,
    align: 'left',
    columnWidth: 640,
  },
]

export const DEFAULT_PRESET = PRESETS[1]
