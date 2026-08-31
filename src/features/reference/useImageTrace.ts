import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Outline } from '@/types/geometry'
import type { OutlineFormat, ResolvedGlyph, VerticalMetrics } from '@/types/font'
import {
  decodeImageFile,
  defaultTolerance,
  traceDecodedImage,
  type DecodedImage,
} from '@/engine/raster/decodeImage'
import {
  fitOutlineToMetrics,
  HORIZONTAL_FIT,
  VERTICAL_FIT,
  type HorizontalFit,
  type VerticalFit,
} from '@/engine/raster/fitToMetrics'

export interface TraceSettings {
  level: number | null
  inkIsDark: boolean | null
  /** Null means "scaled to the image", which is what a new image gets. */
  tolerance: number | null
  /** Pre-trace blur radius; null means scaled to the image. */
  smoothing: number | null
  vertical: VerticalFit
  horizontal: HorizontalFit
}

export const DEFAULT_TRACE_SETTINGS: TraceSettings = {
  level: null,
  inkIsDark: null,
  tolerance: null,
  smoothing: null,
  vertical: VERTICAL_FIT.GlyphBounds,
  horizontal: HORIZONTAL_FIT.KeepAspect,
}

export interface TraceState {
  image: DecodedImage | null
  /** Traced outline placed in the font's metric frame. */
  outline: Outline | null
  /** Traced outline before fitting, in image space. */
  raw: Outline | null
  advanceWidth: number
  notes: string[]
  contourCount: number
  nodeCount: number
  detectedLevel: number
  detectedInkIsDark: boolean
  detectedTolerance: number
  detectedSmoothing: number
  busy: boolean
  error: string | null
}

/**
 * Owns the image and re-traces it whenever a setting changes.
 *
 * Tracing runs off the main thread's critical path by being debounced: a
 * threshold slider fires continuously, and re-tracing a megapixel image on
 * every pixel of travel would make the control feel stuck.
 */
export function useImageTrace(
  glyph: ResolvedGlyph | null,
  metrics: VerticalMetrics,
  outlineFormat: OutlineFormat,
) {
  const [settings, setSettings] = useState<TraceSettings>(DEFAULT_TRACE_SETTINGS)
  const [state, setState] = useState<TraceState>({
    image: null,
    outline: null,
    raw: null,
    advanceWidth: 0,
    notes: [],
    contourCount: 0,
    nodeCount: 0,
    detectedLevel: 128,
    detectedInkIsDark: true,
    detectedTolerance: 1,
    detectedSmoothing: 1,
    busy: false,
    error: null,
  })

  const runId = useRef(0)
  const previousUrl = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (previousUrl.current) URL.revokeObjectURL(previousUrl.current)
    },
    [],
  )

  const load = useCallback(async (file: File) => {
    setState((current) => ({ ...current, busy: true, error: null }))
    try {
      const image = await decodeImageFile(file)
      if (previousUrl.current) URL.revokeObjectURL(previousUrl.current)
      previousUrl.current = image.previewUrl
      setSettings(DEFAULT_TRACE_SETTINGS)
      setState((current) => ({ ...current, image, busy: true, error: null }))
    } catch (error) {
      setState((current) => ({
        ...current,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [])

  const clear = useCallback(() => {
    if (previousUrl.current) URL.revokeObjectURL(previousUrl.current)
    previousUrl.current = null
    runId.current += 1
    setState({
      image: null,
      outline: null,
      raw: null,
      advanceWidth: 0,
      notes: [],
      contourCount: 0,
      nodeCount: 0,
      detectedLevel: 128,
      detectedInkIsDark: true,
      detectedTolerance: 1,
      detectedSmoothing: 1,
      busy: false,
      error: null,
    })
  }, [])

  const target = useMemo(
    () =>
      glyph
        ? {
            bounds: glyph.bounds,
            advanceWidth: glyph.advanceWidth,
            isEmpty: glyph.isEmpty,
          }
        : null,
    [glyph],
  )

  useEffect(() => {
    const image = state.image
    if (!image || !target) return

    const id = ++runId.current
    let cancelled = false

    const timer = setTimeout(() => {
      void (async () => {
        // Marked busy when work actually starts, not while the debounce is
        // still waiting to see whether the slider has settled.
        setState((current) => ({ ...current, busy: true }))
        try {
          const traced = await traceDecodedImage(image, {
            level: settings.level ?? undefined,
            inkIsDark: settings.inkIsDark ?? undefined,
            tolerance: settings.tolerance ?? undefined,
            smoothing: settings.smoothing ?? undefined,
          })
          if (cancelled || id !== runId.current) return

          const fitted = fitOutlineToMetrics(traced.outline, {
            metrics,
            target,
            outlineFormat,
            vertical: settings.vertical,
            horizontal: settings.horizontal,
          })

          setState((current) => ({
            ...current,
            outline: fitted.outline,
            raw: traced.outline,
            advanceWidth: fitted.advanceWidth,
            notes: fitted.notes,
            contourCount: traced.contourCount,
            nodeCount: traced.nodeCount,
            detectedLevel: traced.threshold.level,
            detectedInkIsDark: traced.threshold.inkIsDark,
            detectedTolerance: defaultTolerance(image.gray),
            detectedSmoothing: traced.smoothing,
            busy: false,
            error:
              traced.contourCount === 0
                ? 'No shape was found at this threshold. Try moving it, or invert which side is ink.'
                : null,
          }))
        } catch (error) {
          if (cancelled) return
          setState((current) => ({
            ...current,
            busy: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      })()
    }, 120)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [state.image, settings, target, metrics, outlineFormat])

  return { state, settings, setSettings, load, clear }
}
