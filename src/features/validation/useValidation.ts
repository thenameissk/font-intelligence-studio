import { useCallback, useEffect, useRef, useState } from 'react'
import type { ValidationReport } from '@/types/validation'
import type {
  ValidationRequest,
  ValidationResponse,
} from '@/workers/validationProtocol'
import { useFontStore } from '@/store/fontStore'

export interface ValidationState {
  report: ValidationReport | null
  running: boolean
  error: string | null
  /** True when edits have landed since the last completed run. */
  stale: boolean
  revalidate: () => void
}

/**
 * Runs font QA in a worker, debounced.
 *
 * Reports are tagged with a token so a slow run that finishes after a newer
 * one has started is discarded rather than overwriting fresher results.
 */
export function useValidation(auto = true): ValidationState {
  const parsed = useFontStore((s) => s.parsed)
  const edits = useFontStore((s) => s.edits)

  const workerRef = useRef<Worker | null>(null)
  const tokenRef = useRef(0)
  const latestRef = useRef(0)
  const readyRef = useRef(false)
  const pendingRef = useRef(false)

  const [report, setReport] = useState<ValidationReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  // One worker per font, torn down when the font changes.
  useEffect(() => {
    setReport(null)
    setError(null)
    setStale(false)
    readyRef.current = false
    if (!parsed) return

    const worker = new Worker(
      new URL('../../workers/validation.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<ValidationResponse>) => {
      const message = event.data
      if (message.type === 'ready') {
        readyRef.current = true
        if (pendingRef.current) {
          pendingRef.current = false
          request()
        }
        return
      }
      if (message.type === 'error') {
        setRunning(false)
        setError(message.message)
        return
      }
      // Ignore a report that a newer request has already superseded.
      if (message.token !== latestRef.current) return
      setReport(message.report)
      setRunning(false)
      setStale(false)
    }

    worker.onerror = (event) => {
      setRunning(false)
      setError(event.message || 'The validation worker failed.')
    }

    // The buffer is transferred, so send the worker its own copy and leave
    // the document's bytes intact for export.
    const copy = parsed.sfnt.slice(0)
    const message: ValidationRequest = {
      type: 'load',
      sfnt: copy,
      fileName: parsed.metadata.fileName,
    }
    worker.postMessage(message, [copy])

    return () => {
      worker.terminate()
      workerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed])

  const request = useCallback(() => {
    const worker = workerRef.current
    if (!worker) return
    if (!readyRef.current) {
      pendingRef.current = true
      return
    }
    tokenRef.current += 1
    latestRef.current = tokenRef.current
    setRunning(true)
    setError(null)
    const message: ValidationRequest = {
      type: 'validate',
      token: tokenRef.current,
      edits: useFontStore.getState().edits,
    }
    worker.postMessage(message)
  }, [])

  // Debounced so a burst of node drags results in one pass, not fifty.
  useEffect(() => {
    if (!parsed) return
    setStale(true)
    if (!auto) return
    const timer = setTimeout(request, 400)
    return () => clearTimeout(timer)
  }, [parsed, edits, auto, request])

  return { report, running, error, stale, revalidate: request }
}
