import type { Contour } from '@/types/geometry'

/**
 * Contour clipboard.
 *
 * Deliberately in-memory rather than the system clipboard: copying font
 * contours as text has no agreed format, and reading the system clipboard
 * needs a permission prompt that would interrupt editing.
 */
export const clipboard: { contours: Contour[] } = { contours: [] }
