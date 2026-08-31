import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Clock,
  FilePlus2,
  FolderOpen,
  Loader2,
  Save,
  Trash2,
} from 'lucide-react'
import type { ProjectSummary } from '@/engine/project/storage'
import { currentProjectBackend, isSynced, useSessionStore } from '@/store/sessionStore'
import { Button } from '@/components/ui/Button'
import { useFontStore } from '@/store/fontStore'
import { useProjectStore } from '@/store/projectStore'
import { formatBytes } from '@/utils/format'
import { cn } from '@/utils/cn'

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function ProjectMenu() {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const parsed = useFontStore((s) => s.parsed)
  // Listing has to follow the session: signing in swaps which store the
  // projects come from.
  const session = useSessionStore((s) => s.session)
  const synced = isSynced(session)
  const projectName = useProjectStore((s) => s.projectName)
  const status = useProjectStore((s) => s.status)
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt)
  const versions = useProjectStore((s) => s.versions)
  const projectId = useProjectStore((s) => s.projectId)
  const saveNow = useProjectStore((s) => s.saveNow)
  const snapshot = useProjectStore((s) => s.snapshot)
  const openProject = useProjectStore((s) => s.open)
  const restore = useProjectStore((s) => s.restore)
  const rename = useProjectStore((s) => s.rename)
  const newProject = useProjectStore((s) => s.newProject)

  useEffect(() => {
    if (!open) return
    // `session` is a dependency, not dead code: signing in or out changes
    // which store the list comes from.
    void currentProjectBackend().list().then(setProjects)
    const onClick = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, session])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
      setProjects(await currentProjectBackend().list())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1 rounded-md px-1.5 text-2xs text-ink-muted hover:bg-hover hover:text-ink"
      >
        {status === 'saving' ? (
          <Loader2 size={11} className="animate-spin" />
        ) : status === 'saved' ? (
          <Check size={11} className="text-ok" />
        ) : (
          <Save size={11} />
        )}
        <span className="max-w-[120px] truncate">{projectName}</span>
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute top-8 left-0 z-50 w-72 rounded-md border border-line bg-elevated p-2 shadow-lg">
          <input
            value={projectName}
            onChange={(event) => void rename(event.target.value)}
            className="mb-2 h-7 w-full rounded border border-line bg-input px-2 text-xs text-ink outline-none focus:border-accent"
            aria-label="Project name"
          />

          <div className="flex gap-1">
            <Button
              size="sm"
              disabled={!parsed || busy}
              onClick={() => void run(() => saveNow())}
            >
              <Save size={11} />
              Save
            </Button>
            <Button
              size="sm"
              disabled={!parsed || busy}
              onClick={() =>
                void run(() =>
                  snapshot(`Version ${new Date().toLocaleTimeString()}`),
                )
              }
            >
              <Clock size={11} />
              Snapshot
            </Button>
            <Button size="sm" onClick={newProject}>
              <FilePlus2 size={11} />
              New
            </Button>
          </div>

          {lastSavedAt && (
            <p className="mt-1.5 text-[10px] text-ink-faint">
              Saved {timeAgo(lastSavedAt)} · edits only, the font is stored once
            </p>
          )}

          {versions.length > 0 && (
            <>
              <p className="mt-3 mb-1 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
                Version history
              </p>
              <ul className="max-h-40 overflow-y-auto">
                {versions.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={() => void run(() => restore(version.id))}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-hover"
                    >
                      <Clock size={10} className="shrink-0 text-ink-faint" />
                      <span className="min-w-0 flex-1 truncate text-2xs text-ink">
                        {version.label}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                        {version.editedGlyphs}g
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-3 mb-1 flex items-baseline gap-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
            Projects
            <span className="font-normal normal-case">
              {synced ? 'on the server' : 'in this browser'}
            </span>
          </p>
          {projects.length === 0 ? (
            <p className="px-1.5 py-2 text-[10px] text-ink-faint">
              Nothing saved yet.
            </p>
          ) : (
            <ul className="max-h-48 overflow-y-auto">
              {projects.map((project) => (
                <li key={project.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void run(() => openProject(project.id))}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-hover',
                      project.id === projectId && 'bg-accent-soft',
                    )}
                  >
                    <FolderOpen size={10} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-2xs text-ink">
                        {project.name}
                      </span>
                      <span className="block truncate text-[10px] text-ink-faint">
                        {project.fontFileName} · {formatBytes(project.fontSize)}{' '}
                        · {timeAgo(project.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${project.name}`}
                    onClick={() =>
                      void run(async () => {
                        await currentProjectBackend().remove(project.id)
                      })
                    }
                    className="shrink-0 rounded p-1 text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-danger"
                  >
                    <Trash2 size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
