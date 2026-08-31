/**
 * Reading an image file into the grayscale form the tracer works on.
 *
 * The only part of the raster pipeline that touches the DOM, kept separate
 * so everything downstream stays testable without a browser.
 */
import type { GrayImage } from './types'

export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
] as const

/**
 * Large photographs are downscaled before tracing. Beyond about a thousand
 * pixels the extra detail is sensor noise rather than letterform, and it
 * slows the trace for nothing.
 */
const MAX_DIMENSION = 1100

export interface DecodedImage {
  gray: GrayImage
  /** Kept for display alongside the trace. */
  previewUrl: string
  originalWidth: number
  originalHeight: number
  scale: number
}

export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)
  )
}

export async function decodeImageFile(file: File): Promise<DecodedImage> {
  if (!isImageFile(file)) {
    throw new Error('That file is not an image.')
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This image could not be decoded.')
  })

  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  )
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error('This browser could not provide a drawing surface.')
  }

  // Transparent pixels have to become paper, not black, or every PNG with a
  // cut-out background traces as a solid rectangle.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const { data } = context.getImageData(0, 0, width, height)
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Rec. 601 luma, which matches how the eye weighs the channels.
    gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }

  return {
    gray: { width, height, data: gray },
    previewUrl: URL.createObjectURL(file),
    originalWidth: bitmap.width,
    originalHeight: bitmap.height,
    scale,
  }
}

/**
 * A fitting tolerance proportional to the image.
 *
 * Tolerance is in pixels, so a fixed value means a large scan is traced far
 * more tightly than a small one and arrives with hundreds of nodes nobody
 * can edit. Scaling with height keeps the node count roughly constant
 * whatever the source resolution.
 */
export function defaultTolerance(image: GrayImage): number {
  return Math.max(0.6, Math.min(3.5, image.height / 220))
}

/** Runs the whole trace for a decoded image at a given threshold. */
export async function traceDecodedImage(
  decoded: DecodedImage,
  overrides: {
    level?: number
    inkIsDark?: boolean
    tolerance?: number
    smoothing?: number
  } = {},
) {
  const [
    { analyzeThreshold, inkField },
    { traceContours },
    { vectorizePolygons },
    { blurField, defaultBlurRadius },
  ] = await Promise.all([
    import('./threshold'),
    import('./trace'),
    import('./vectorize'),
    import('./blur'),
  ])

  const automatic = analyzeThreshold(decoded.gray)
  const options = {
    level: overrides.level ?? automatic.level,
    inkIsDark: overrides.inkIsDark ?? automatic.inkIsDark,
  }
  const raw = inkField(decoded.gray, options)
  const radius = overrides.smoothing ?? defaultBlurRadius(decoded.gray)
  const field = blurField(
    raw.field,
    decoded.gray.width,
    decoded.gray.height,
    radius,
  )
  const isoLevel = raw.isoLevel
  const polygons = traceContours(
    field,
    decoded.gray.width,
    decoded.gray.height,
    { isoLevel },
  )
  const result = vectorizePolygons(polygons, {
    tolerance: overrides.tolerance ?? defaultTolerance(decoded.gray),
  })

  return {
    ...result,
    threshold: options,
    smoothing: radius,
    polygonCount: polygons.length,
  }
}
