import { AlertTriangle, FileType2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useFontStore } from '@/store/fontStore'
import { isSynced, useSessionStore } from '@/store/sessionStore'
import { ACCEPTED_EXTENSIONS, pickFontFile } from './useFontDrop'

const FORMAT_NOTES: Array<[string, string]> = [
  ['TTF / OTF', 'Parsed directly, full geometry access'],
  ['WOFF', 'Unwrapped in the browser'],
  ['WOFF2', 'Brotli-decompressed via WebAssembly'],
  ['TTC', 'First font in the collection'],
]

export function ImportScreen({ dragging }: { dragging: boolean }) {
  const status = useFontStore((s) => s.status)
  const error = useFontStore((s) => s.error)
  const importFile = useFontStore((s) => s.importFile)
  // Where the font will end up depends on whether this browser is signed in
  // to a server. Saying "nothing is uploaded" while syncing to one would be
  // a lie, and this is exactly the moment somebody decides whether to hand
  // over a font they may not own.
  const synced = useSessionStore((s) => isSynced(s.session))

  const openPicker = async (): Promise<void> => {
    const file = await pickFontFile()
    if (file) void importFile(file)
  }

  const loading = status === 'loading'

  return (
    <div className="flex h-full items-center justify-center bg-base p-8">
      <div className="w-full max-w-md">
        <div
          className={[
            'flex flex-col items-center rounded-lg border border-dashed px-8 py-12 text-center transition-colors',
            dragging
              ? 'border-accent bg-accent-soft/40'
              : 'border-line-strong bg-panel',
          ].join(' ')}
        >
          {loading ? (
            <Loader2 size={28} className="animate-spin text-accent" />
          ) : (
            <FileType2 size={28} className="text-ink-faint" strokeWidth={1.5} />
          )}

          <h2 className="mt-4 text-sm font-semibold text-ink">
            {loading ? 'Parsing font…' : 'Open a font to begin'}
          </h2>
          <p className="mt-1 max-w-xs text-xs text-ink-muted">
            Drop a font file anywhere in the window, or choose one. Parsing,
            editing and export all happen in this browser.
          </p>
          <p className="mt-1.5 max-w-xs text-2xs text-ink-faint">
            {synced
              ? 'Saving a project uploads the font to the server, where your team can reach it.'
              : 'Nothing is uploaded — projects stay in this browser.'}
          </p>

          <Button
            variant="primary"
            className="mt-5"
            disabled={loading}
            onClick={() => void openPicker()}
          >
            Choose font file
          </Button>

          <p className="mt-3 font-mono text-2xs text-ink-faint">
            {ACCEPTED_EXTENSIONS.join('  ')}
          </p>
        </div>

        {error && (
          <div className="mt-3 flex gap-2 rounded-md border border-line bg-panel p-3">
            <AlertTriangle size={14} className="mt-px shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink">
                That font could not be opened
              </p>
              <p data-selectable className="mt-0.5 text-2xs text-ink-muted">
                {error}
              </p>
            </div>
          </div>
        )}

        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {FORMAT_NOTES.map(([format, note]) => (
            <div key={format} className="contents">
              <dt className="font-mono text-2xs text-ink-muted">{format}</dt>
              <dd className="text-2xs text-ink-faint">{note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
