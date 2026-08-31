/**
 * Turning a photograph or screenshot of a letter into ink and paper.
 *
 * The threshold is chosen by Otsu's method, which picks the level that best
 * separates the histogram into two groups. It needs no tuning and copes with
 * the uneven exposure of a phone photo far better than a fixed value.
 */
import type { GrayImage } from './types'

export interface ThresholdResult {
  /** The chosen level, 0-255. */
  level: number
  /** True when ink is the darker of the two groups. */
  inkIsDark: boolean
}

export function histogram(image: GrayImage): Uint32Array {
  const counts = new Uint32Array(256)
  for (let i = 0; i < image.data.length; i += 1) counts[image.data[i]] += 1
  return counts
}

/** Otsu's method: the level that maximises between-class variance. */
export function otsuThreshold(image: GrayImage): number {
  const counts = histogram(image)
  const total = image.data.length
  if (total === 0) return 128

  let sum = 0
  for (let level = 0; level < 256; level += 1) sum += level * counts[level]

  let backgroundWeight = 0
  let backgroundSum = 0
  let bestVariance = -1
  // A clean two-tone image gives the same variance across the whole empty
  // gap between its two peaks. Taking the first such level puts the
  // threshold hard against one tone, which then clips every antialiased
  // edge; the midpoint of the tied range is the level a person would pick.
  let firstBest = 0
  let lastBest = 0

  for (let level = 0; level < 256; level += 1) {
    backgroundWeight += counts[level]
    if (backgroundWeight === 0) continue
    const foregroundWeight = total - backgroundWeight
    if (foregroundWeight === 0) break

    backgroundSum += level * counts[level]
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (sum - backgroundSum) / foregroundWeight
    const between =
      backgroundWeight *
      foregroundWeight *
      (backgroundMean - foregroundMean) ** 2

    if (between > bestVariance) {
      bestVariance = between
      firstBest = level
      lastBest = level
    } else if (between === bestVariance) {
      lastBest = level
    }
  }
  return Math.round((firstBest + lastBest) / 2)
}

/**
 * Decides which side of the threshold is ink.
 *
 * A letter occupies less of its image than the background does, so the
 * smaller group is the ink. That reading beats assuming dark-on-light, which
 * fails on every white-on-black sample.
 */
export function analyzeThreshold(image: GrayImage): ThresholdResult {
  const level = otsuThreshold(image)
  let dark = 0
  for (let i = 0; i < image.data.length; i += 1) {
    if (image.data[i] <= level) dark += 1
  }
  const light = image.data.length - dark
  return { level, inkIsDark: dark <= light }
}

/**
 * The "inkness" field: 0 is paper, 1 is solid ink, whichever way round the
 * original image was.
 *
 * Marching squares interpolates across this field rather than stepping over
 * hard pixels, which is what keeps a traced curve smooth instead of
 * staircased. The contour is taken at `isoLevel`, so no remapping is needed.
 */
export function inkField(
  image: GrayImage,
  options: ThresholdResult,
): { field: Float32Array; isoLevel: number } {
  const field = new Float32Array(image.width * image.height)
  const { level, inkIsDark } = options
  for (let i = 0; i < field.length; i += 1) {
    const value = image.data[i]
    field[i] = inkIsDark ? (255 - value) / 255 : value / 255
  }
  const isoLevel = inkIsDark ? (255 - level) / 255 : level / 255
  return { field, isoLevel }
}
