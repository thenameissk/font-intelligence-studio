export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Rounds for display without printing "-0" or trailing zeros. */
export function formatUnits(value: number, precision = 0): string {
  const rounded = Number(value.toFixed(precision))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

export function formatRatio(value: number, precision = 2): string {
  return value.toFixed(precision)
}

export function formatSigned(value: number, precision = 0): string {
  const rounded = Number(value.toFixed(precision))
  if (rounded === 0) return '0'
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function modKey(): string {
  return isMac ? '⌘' : 'Ctrl'
}
