import { useState } from 'react'
import { AlertTriangle, Loader2, MonitorCog, Trash2, Upload, X } from 'lucide-react'
import {
  importFontFiles,
  importInstalledFonts,
  listInstalledFonts,
  pickOnePerFamily,
  supportsLocalFonts,
  type InstalledFace,
} from '@/engine/library/importFonts'
import { MAX_LIBRARY_FONTS } from '@/engine/library/libraryDb'
import { useLibraryStore } from '@/store/libraryStore'
import { hasFontExtension } from '@/features/import/useFontDrop'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { useLibraryList } from './useLibrary'

/**
 * The reference library manager.
 *
 * The library is the studio's memory of other typefaces. Everything in it
 * was put there deliberately by the person using it, which is what makes the
 * comparisons trustworthy and the licensing their own to reason about.
 */
export function LibraryDialog({ onClose }: { onClose: () => void }) {
  const { entries, refresh, remove } = useLibraryList()
  const emptyLibrary = useLibraryStore((s) => s.empty)
  const [busy, setBusy] = useState<string | null>(null)
  const [failures, setFailures] = useState<Array<{ name: string; reason: string }>>([])
  const [dropping, setDropping] = useState(false)
  const [installed, setInstalled] = useState<InstalledFace[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const addFiles = async (files: File[]): Promise<void> => {
    const fonts = files.filter((file) => hasFontExtension(file.name))
    if (fonts.length === 0) {
      setFailures([{ name: 'Nothing added', reason: 'No font files in that drop.' }])
      return
    }
    setBusy(`Adding 0/${fonts.length}…`)
    const outcome = await importFontFiles(fonts, (done, total) =>
      setBusy(`Adding ${done}/${total}…`),
    )
    setFailures(outcome.failed)
    setBusy(null)
    await refresh()
  }

  const browseInstalled = async (): Promise<void> => {
    setBusy('Reading installed fonts…')
    try {
      const faces = await listInstalledFonts()
      setInstalled(pickOnePerFamily(faces))
      setPicked(new Set())
    } catch (error) {
      setFailures([
        {
          name: 'Installed fonts',
          reason:
            error instanceof Error
              ? error.message
              : 'Permission to list installed fonts was refused.',
        },
      ])
    }
    setBusy(null)
  }

  const addInstalled = async (): Promise<void> => {
    const names = [...picked]
    setBusy(`Adding 0/${names.length}…`)
    const outcome = await importInstalledFonts(names, (done, total) =>
      setBusy(`Adding ${done}/${total}…`),
    )
    setFailures(outcome.failed)
    setBusy(null)
    setInstalled(null)
    await refresh()
  }

  const room = MAX_LIBRARY_FONTS - entries.length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDropping(false)
          void addFiles([...event.dataTransfer.files])
        }}
        className={cn(
          'flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-panel shadow-xl',
          dropping ? 'border-accent' : 'border-line',
        )}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="text-xs font-semibold text-ink">Reference library</h2>
          <span className="text-2xs text-ink-faint">
            {entries.length} of {MAX_LIBRARY_FONTS}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <X size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {installed ? (
            <InstalledPicker
              faces={installed}
              picked={picked}
              setPicked={setPicked}
              room={room}
              onCancel={() => setInstalled(null)}
            />
          ) : (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
                Typefaces added here are used to show how other designers draw
                the letter you are editing. They are stored in this browser
                and never uploaded. Borrowing a drawing from one of them is
                subject to that font's licence.
              </p>

              {entries.length === 0 ? (
                <div className="rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
                  <p className="text-xs text-ink-muted">
                    Drop font files here, or add from the fonts installed on
                    this machine.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {entries.map((entry) => (
                    <li key={entry.id} className="group flex items-center gap-2 px-2 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-ink">
                          {entry.family}
                        </span>
                        <span className="block truncate text-[10px] text-ink-faint">
                          {entry.style} · {entry.numGlyphs.toLocaleString()} glyphs ·{' '}
                          {entry.outlineFormat === 'truetype' ? 'TrueType' : 'CFF'}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${entry.family}`}
                        onClick={() => void remove(entry.id)}
                        className="shrink-0 rounded p-1 text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-danger"
                      >
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {failures.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {failures.map((failure, index) => (
                    <li key={index} className="flex gap-1.5 text-[10px] text-ink-muted">
                      <AlertTriangle size={10} className="mt-px shrink-0 text-warn" />
                      <span>
                        <span className="text-ink">{failure.name}</span> — {failure.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-3">
          {busy ? (
            <span className="flex flex-1 items-center gap-1.5 text-2xs text-ink-muted">
              <Loader2 size={11} className="animate-spin" />
              {busy}
            </span>
          ) : (
            <span className="flex-1 text-2xs text-ink-faint">
              {room > 0 ? `Room for ${room} more` : 'Library is full'}
            </span>
          )}

          {installed ? (
            <>
              <Button onClick={() => setInstalled(null)}>Back</Button>
              <Button
                variant="primary"
                disabled={picked.size === 0 || busy !== null}
                onClick={() => void addInstalled()}
              >
                Add {picked.size}
              </Button>
            </>
          ) : (
            <>
              {entries.length > 0 && (
                <Button
                  variant="danger"
                  onClick={() => void emptyLibrary()}
                >
                  Empty
                </Button>
              )}
              {supportsLocalFonts() && (
                <Button disabled={busy !== null} onClick={() => void browseInstalled()}>
                  <MonitorCog size={12} />
                  Installed fonts
                </Button>
              )}
              <Button
                variant="primary"
                disabled={busy !== null || room <= 0}
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.multiple = true
                  input.accept = '.ttf,.otf,.woff,.woff2,.ttc'
                  input.addEventListener('change', () =>
                    void addFiles([...(input.files ?? [])]),
                  )
                  input.click()
                }}
              >
                <Upload size={12} />
                Add fonts
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

function InstalledPicker({
  faces,
  picked,
  setPicked,
  room,
  onCancel,
}: {
  faces: InstalledFace[]
  picked: Set<string>
  setPicked: (next: Set<string>) => void
  room: number
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const shown = faces.filter((face) =>
    face.family.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const toggle = (name: string): void => {
    const next = new Set(picked)
    if (next.has(name)) next.delete(name)
    else if (next.size < room) next.add(name)
    setPicked(next)
  }

  if (faces.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-xs text-ink-muted">
          No installed fonts were returned. The browser may have refused
          permission.
        </p>
        <Button size="sm" className="mt-3" onClick={onCancel}>
          Back
        </Button>
      </div>
    )
  }

  return (
    <>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${faces.length} families…`}
        className="mb-2 h-7 w-full rounded-md border border-line bg-input px-2 text-xs text-ink outline-none focus:border-accent"
      />
      <p className="mb-2 text-[10px] text-ink-faint">
        One representative face per family. {picked.size} selected, room for{' '}
        {room}.
      </p>
      <ul className="grid grid-cols-2 gap-x-3">
        {shown.map((face) => (
          <li key={face.postscriptName}>
            <label className="flex cursor-pointer items-center gap-1.5 py-0.5">
              <input
                type="checkbox"
                checked={picked.has(face.postscriptName)}
                onChange={() => toggle(face.postscriptName)}
                className="accent-[var(--fis-accent)]"
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                {face.family}
              </span>
              <span className="shrink-0 text-[9px] text-ink-faint">
                {face.style}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}
