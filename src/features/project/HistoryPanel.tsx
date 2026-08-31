import { Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { IconButton } from '@/components/ui/Button'
import { useHistoryStore } from '@/store/historyStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/utils/cn'

/**
 * The operation history.
 *
 * Every entry is a command with the glyphs it touched, which makes it clear
 * what a step actually did before undoing past it.
 */
export function HistoryPanel() {
  const open = useUiStore((s) => s.historyOpen)
  const toggle = useUiStore((s) => s.toggleHistory)
  const past = useHistoryStore((s) => s.past)
  const future = useHistoryStore((s) => s.future)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  if (!open) return null

  const entries = [
    ...past.map((command) => ({ command, undone: false })),
    ...future.map((command) => ({ command, undone: true })),
  ]

  return (
    <div className="absolute right-2 bottom-8 z-40 w-64 rounded-md border border-line bg-elevated shadow-lg">
      <header className="flex h-8 items-center gap-1 border-b border-line px-2">
        <span className="flex-1 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
          History
        </span>
        <IconButton label="Undo" disabled={past.length === 0} onClick={undo}>
          <Undo2 size={12} />
        </IconButton>
        <IconButton label="Redo" disabled={future.length === 0} onClick={redo}>
          <Redo2 size={12} />
        </IconButton>
        <IconButton label="Close history" onClick={toggle}>
          <RotateCcw size={12} />
        </IconButton>
      </header>

      <ul className="max-h-64 overflow-y-auto py-1">
        {entries.length === 0 && (
          <li className="px-3 py-4 text-center text-2xs text-ink-faint">
            Nothing yet.
          </li>
        )}
        {entries.map(({ command, undone }, index) => (
          <li
            key={command.id}
            className={cn(
              'flex items-baseline gap-2 px-2 py-1',
              undone && 'opacity-40',
            )}
          >
            <span className="w-5 shrink-0 text-right font-mono text-[10px] text-ink-faint">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-2xs text-ink">
              {command.label}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-ink-faint">
              {command.glyphs.length > 0 ? `${command.glyphs.length}g` : 'kern'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
