import { useEffect, useRef } from 'react'
import { useFontStore } from '@/store/fontStore'
import { useProjectStore } from '@/store/projectStore'

const DEBOUNCE_MS = 2500

/**
 * Autosave.
 *
 * Only fires once a project exists and something has actually been edited,
 * so simply opening a font does not silently fill the user's storage with
 * projects they never asked for.
 */
export function useAutosave(): void {
  const revision = useFontStore((s) => s.revision)
  const parsed = useFontStore((s) => s.parsed)
  const lastSaved = useRef(-1)

  useEffect(() => {
    if (!parsed) return
    const project = useProjectStore.getState()
    if (!project.autosave || !project.projectId) return
    if (revision === lastSaved.current) return

    const timer = setTimeout(() => {
      lastSaved.current = revision
      void useProjectStore.getState().saveNow()
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [revision, parsed])
}
