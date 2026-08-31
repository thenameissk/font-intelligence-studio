import { useEffect, useRef, useState } from 'react'
import { Cloud, HardDrive, Loader2, LogIn, LogOut, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { isSynced, useSessionStore } from '@/store/sessionStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useProjectStore } from '@/store/projectStore'
import { cn } from '@/utils/cn'

/**
 * Where your work is being kept, and who you are.
 *
 * This is deliberately always visible rather than tucked into a settings
 * page. "Is this font on a server or only on my machine" is not a detail
 * somebody should have to go looking for.
 */
export function SessionMenu() {
  const session = useSessionStore((s) => s.session)
  const checked = useSessionStore((s) => s.checked)
  const busy = useSessionStore((s) => s.busy)
  const error = useSessionStore((s) => s.error)
  const check = useSessionStore((s) => s.check)
  const signIn = useSessionStore((s) => s.signIn)
  const signOut = useSessionStore((s) => s.signOut)

  const refreshLibrary = useLibraryStore((s) => s.refresh)
  const refreshProjects = useProjectStore((s) => s.refreshVersions)

  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void check()
  }, [check])

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Nothing to say when the studio is running as a static site.
  if (!checked || !session.available) return null

  const synced = isSynced(session)

  const afterChange = async (): Promise<void> => {
    // Both stores read from whichever backend is now current.
    await refreshLibrary()
    await refreshProjects()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          synced
            ? `Signed in as ${session.username}. Projects and the reference library are on the server.`
            : 'Working locally. Nothing leaves this browser.'
        }
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md border px-2 text-2xs transition-colors',
          synced
            ? 'border-accent/40 bg-accent-soft text-accent'
            : 'border-line text-ink-muted hover:bg-hover hover:text-ink',
        )}
      >
        {synced ? <Cloud size={11} /> : <HardDrive size={11} />}
        <span className="max-w-[90px] truncate">
          {synced ? session.username : 'Local only'}
        </span>
      </button>

      {open && (
        <div className="absolute top-8 right-0 z-50 w-72 rounded-md border border-line bg-elevated p-3 shadow-lg">
          {synced ? (
            <>
              <p className="text-xs font-medium text-ink">
                Signed in as {session.username}
              </p>
              <ul className="mt-2 space-y-1 text-[11px] text-ink-muted">
                <li className="flex gap-1.5">
                  <Cloud size={11} className="mt-px shrink-0" />
                  Projects and their history are saved on the server.
                </li>
                <li className="flex gap-1.5">
                  <Users size={11} className="mt-px shrink-0" />
                  The reference library is shared with your team.
                </li>
              </ul>
              <Button
                size="sm"
                className="mt-3"
                disabled={busy}
                onClick={() => void signOut().then(afterChange)}
              >
                <LogOut size={11} />
                Sign out
              </Button>
              <p className="mt-2 text-[10px] text-ink-faint">
                Signing out switches back to this browser's own storage.
                Nothing on the server is deleted.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-ink">Working locally</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                Projects are in this browser and no font leaves the machine.
                Sign in to keep them on the server and share a reference
                library with your team.
              </p>

              <form
                className="mt-3 space-y-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void signIn(username, password).then(async (ok) => {
                    if (!ok) return
                    setPassword('')
                    setOpen(false)
                    await afterChange()
                  })
                }}
              >
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                  className="h-7 w-full rounded border border-line bg-input px-2 text-xs text-ink outline-none focus:border-accent"
                />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  placeholder="Password"
                  autoComplete="current-password"
                  className="h-7 w-full rounded border border-line bg-input px-2 text-xs text-ink outline-none focus:border-accent"
                />
                {error && (
                  <p className="text-[10px] text-danger">{error}</p>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  disabled={busy || username.length === 0}
                  type="submit"
                >
                  {busy ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <LogIn size={11} />
                  )}
                  Sign in
                </Button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  )
}
