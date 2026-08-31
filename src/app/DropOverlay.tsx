import { FileType2 } from 'lucide-react'

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-base/70 backdrop-blur-[1px]">
      <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-accent bg-panel px-10 py-8">
        <FileType2 size={24} className="text-accent" strokeWidth={1.5} />
        <p className="text-sm font-medium text-ink">Drop to replace font</p>
        <p className="text-2xs text-ink-muted">
          Unsaved edits to the current font will be discarded
        </p>
      </div>
    </div>
  )
}
