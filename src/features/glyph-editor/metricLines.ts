import type { FontDna } from '@/types/analysis'
import type { VerticalMetrics } from '@/types/font'
import type { MetricLine } from './layers/MetricsLayer'

/**
 * The horizontal reference lines shown behind a glyph.
 *
 * x-height and cap height prefer the measured values from Font DNA, because
 * many fonts either omit the OS/2 fields or declare values that disagree
 * with the actual outlines.
 */
export function buildMetricLines(
  metrics: VerticalMetrics,
  dna: FontDna | null,
): MetricLine[] {
  const lines: MetricLine[] = [{ label: 'baseline', value: 0, strong: true }]

  const xHeight = dna?.xHeight.value ?? metrics.xHeight
  const capHeight = dna?.capHeight.value ?? metrics.capHeight

  if (xHeight !== null && xHeight !== undefined && xHeight > 0) {
    lines.push({ label: 'x-height', value: Math.round(xHeight) })
  }
  if (capHeight !== null && capHeight !== undefined && capHeight > 0) {
    lines.push({ label: 'cap', value: Math.round(capHeight) })
  }
  lines.push({ label: 'ascender', value: Math.round(metrics.ascender) })
  lines.push({ label: 'descender', value: Math.round(metrics.descender) })

  // Drop duplicates that would stack invisibly on one another.
  const seen = new Set<number>()
  return lines.filter((line) => {
    if (seen.has(line.value)) return false
    seen.add(line.value)
    return true
  })
}
