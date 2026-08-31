/**
 * Raster types for the image reference pipeline.
 *
 * Kept free of any browser type so the whole tracing engine can be tested
 * without a DOM. Only `decodeImage` touches canvas.
 */

/** Single-channel image, 0 = black, 255 = white, row-major. */
export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

/** Binary mask, 1 = ink. */
export interface Mask {
  width: number
  height: number
  data: Uint8Array
}

export function grayAt(image: GrayImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 255
  return image.data[y * image.width + x]
}

export function createGray(width: number, height: number, fill = 255): GrayImage {
  const data = new Uint8Array(width * height)
  data.fill(fill)
  return { width, height, data }
}
