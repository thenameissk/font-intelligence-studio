/** Standard OS/2 class names, plus the buckets the analyzer estimates into. */

export const WEIGHT_CLASS_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
  950: 'Extra Black',
}

export const WIDTH_CLASS_NAMES: Record<number, string> = {
  1: 'Ultra Condensed',
  2: 'Extra Condensed',
  3: 'Condensed',
  4: 'Semi Condensed',
  5: 'Normal',
  6: 'Semi Expanded',
  7: 'Expanded',
  8: 'Extra Expanded',
  9: 'Ultra Expanded',
}

/** Nearest standard weight name for an arbitrary usWeightClass value. */
export function nearestWeightName(weightClass: number): string {
  const steps = Object.keys(WEIGHT_CLASS_NAMES).map(Number)
  let best = steps[0]
  for (const step of steps) {
    if (Math.abs(step - weightClass) < Math.abs(best - weightClass)) best = step
  }
  return WEIGHT_CLASS_NAMES[best]
}
