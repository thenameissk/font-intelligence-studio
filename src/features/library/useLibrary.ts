import { useEffect, useRef, useState } from 'react'
import type { LibraryEntry } from '@/engine/library/libraryDb'
import { extractSpecimen, type Specimen } from '@/engine/library/specimen'
import { useLibraryStore } from '@/store/libraryStore'

/** The shared library listing, loaded on first use. */
export function useLibraryList() {
  const entries = useLibraryStore((s) => s.entries)
  const loading = useLibraryStore((s) => s.loading)
  const ensureLoaded = useLibraryStore((s) => s.ensureLoaded)
  const refresh = useLibraryStore((s) => s.refresh)
  const remove = useLibraryStore((s) => s.remove)

  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  return { entries, loading, refresh, remove }
}

export interface SpecimenState {
  specimens: Specimen[]
  /** Fonts examined so far, out of how many. */
  done: number
  total: number
  /** Fonts that do not draw this character at all. */
  missing: number
  loading: boolean
}

/**
 * Collects the same letter from every font in the library.
 *
 * Results arrive one at a time rather than in a single batch: parsing a
 * dozen fonts takes long enough that a grid which fills in progressively
 * feels immediate where one that appears all at once feels stuck.
 */
export function useSpecimens(
  entries: readonly LibraryEntry[],
  codepoint: number | null,
): SpecimenState {
  // Results are tagged with the run that produced them. Keying on the
  // codepoint alone is not enough: the effect re-runs whenever the entries
  // array arrives as a new reference, and a second pass over the same fonts
  // would then append a duplicate of every specimen.
  const [run, setRun] = useState<{
    token: number
    codepoint: number | null
    specimens: Specimen[]
    done: number
    missing: number
  }>({ token: 0, codepoint: null, specimens: [], done: 0, missing: 0 })

  const runId = useRef(0)
  const signature = entries.map((entry) => entry.id).join(',')

  useEffect(() => {
    const token = ++runId.current
    if (codepoint === null || entries.length === 0) return

    void (async () => {
      for (const entry of entries) {
        if (token !== runId.current) return
        let specimen: Specimen | null = null
        try {
          specimen = await extractSpecimen(entry, codepoint)
        } catch {
          specimen = null
        }
        if (token !== runId.current) return

        setRun((current) => {
          const continuing = current.token === token
          return {
            token,
            codepoint,
            specimens: specimen
              ? [...(continuing ? current.specimens : []), specimen]
              : continuing
                ? current.specimens
                : [],
            done: (continuing ? current.done : 0) + 1,
            missing: (continuing ? current.missing : 0) + (specimen ? 0 : 1),
          }
        })

        // Yield between fonts so the grid paints as it fills.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })()

    return () => {
      runId.current += 1
    }
    // `signature` stands in for the contents of `entries`, so a re-render
    // that merely re-creates the array does not restart the scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, codepoint])

  const matches = run.codepoint === codepoint && codepoint !== null
  const total = entries.length
  const done = matches ? Math.min(run.done, total) : 0

  return {
    specimens: matches ? run.specimens : [],
    done,
    total,
    missing: matches ? run.missing : 0,
    loading: codepoint !== null && total > 0 && done < total,
  }
}
