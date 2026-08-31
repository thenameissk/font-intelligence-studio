import type { Point } from './geometry'

export const ISSUE_CODE = {
  SelfIntersection: 'self-intersection',
  OpenContour: 'open-contour',
  DuplicateNode: 'duplicate-node',
  TinyContour: 'tiny-contour',
  MalformedCurve: 'malformed-curve',
  ContourDirection: 'contour-direction',
  InconsistentCurvature: 'inconsistent-curvature',
  AbnormalSideBearing: 'abnormal-side-bearing',
  InconsistentWidth: 'inconsistent-width',
  InvalidMetrics: 'invalid-metrics',
  ExtremeOvershoot: 'extreme-overshoot',
  InconsistentStem: 'inconsistent-stem',
  UnusualProportion: 'unusual-proportion',
  InconsistentTerminal: 'inconsistent-terminal',
  MissingGlyph: 'missing-glyph',
  EmptyEncodedGlyph: 'empty-encoded-glyph',
} as const
export type IssueCode = (typeof ISSUE_CODE)[keyof typeof ISSUE_CODE]

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface Issue {
  id: string
  code: IssueCode
  severity: IssueSeverity
  title: string
  detail: string
  /** null for font-level issues such as missing coverage. */
  glyphIndex: number | null
  glyphName: string | null
  contourIndex?: number
  nodeId?: string
  /** Where to look, in font units. */
  point?: Point
}

export interface ValidationReport {
  score: number
  glyphsChecked: number
  glyphsWithIssues: number
  issues: Issue[]
  counts: Record<string, number>
  errorCount: number
  warningCount: number
  infoCount: number
  missingRecommended: number[]
  metricsValid: boolean
  durationMs: number
  /** True when checking stopped early because the font is very large. */
  truncated: boolean
}

export const ISSUE_LABELS: Record<IssueCode, string> = {
  'self-intersection': 'Self-intersections',
  'open-contour': 'Open contours',
  'duplicate-node': 'Duplicate nodes',
  'tiny-contour': 'Tiny contours',
  'malformed-curve': 'Malformed curves',
  'contour-direction': 'Contour direction',
  'inconsistent-curvature': 'Inconsistent curvature',
  'abnormal-side-bearing': 'Spacing anomalies',
  'inconsistent-width': 'Inconsistent widths',
  'invalid-metrics': 'Invalid metrics',
  'extreme-overshoot': 'Extreme overshoot',
  'inconsistent-stem': 'Inconsistent stems',
  'unusual-proportion': 'Unusual proportions',
  'inconsistent-terminal': 'Inconsistent terminals',
  'missing-glyph': 'Missing recommended glyphs',
  'empty-encoded-glyph': 'Empty encoded glyphs',
}
