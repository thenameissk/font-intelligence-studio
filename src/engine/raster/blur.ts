/**
 * Smoothing before tracing.
 *
 * Sub-pixel contour tracing works by interpolating across the edge, which
 * needs an edge with some width to it. A hard 1-bit source -- a fax, a
 * screenshot of small text, anything rendered without antialiasing -- has
 * none: every pixel is fully ink or fully paper, the interpolation always
 * lands halfway, and the trace comes out as a literal staircase that the
 * curve fitter then faithfully reproduces with hundreds of nodes.
 *
 * A small blur restores the gradient, and the trace follows the shape the
 * pixels imply rather than the grid they sit on. Softly antialiased sources
 * are barely affected.
 */
import type { GrayImage } from './types'

/** Separable box blur, run twice, which approximates a Gaussian closely. */
function boxBlurPass(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const span = radius * 2 + 1
  const outer = horizontal ? height : width
  const inner = horizontal ? width : height
  const stride = horizontal ? 1 : width
  const lineStep = horizontal ? width : 1

  for (let o = 0; o < outer; o += 1) {
    const base = o * lineStep
    let sum = 0
    // Prime the window, clamping at the edge so borders do not darken.
    for (let i = -radius; i <= radius; i += 1) {
      const clamped = Math.max(0, Math.min(inner - 1, i))
      sum += source[base + clamped * stride]
    }
    for (let i = 0; i < inner; i += 1) {
      target[base + i * stride] = sum / span
      const outgoing = Math.max(0, Math.min(inner - 1, i - radius))
      const incoming = Math.max(0, Math.min(inner - 1, i + radius + 1))
      sum += source[base + incoming * stride] - source[base + outgoing * stride]
    }
  }
}

/**
 * A blur radius proportional to the image, so a 4000-pixel scan and a
 * 200-pixel screenshot are smoothed by the same visual amount.
 */
export function defaultBlurRadius(image: GrayImage): number {
  return Math.max(1, Math.round(Math.max(image.width, image.height) / 400))
}

export function blurField(
  field: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius < 1) return field
  const a = new Float32Array(field.length)
  const b = new Float32Array(field.length)

  boxBlurPass(field, a, width, height, radius, true)
  boxBlurPass(a, b, width, height, radius, false)
  boxBlurPass(b, a, width, height, radius, true)
  boxBlurPass(a, b, width, height, radius, false)

  return b
}
