/**
 * Session and storage mode.
 *
 * The studio decides where work is kept from one fact: is somebody signed
 * in to a server behind this page. Signed in means projects and the
 * reference library are shared and backed up; otherwise everything stays in
 * this browser and no font leaves the machine.
 *
 * Whichever it is, the UI says so. A person should never have to wonder
 * whether their work just went to a server.
 */
import { create } from 'zustand'
import {
  fetchSession,
  serverAvailable,
  signIn as apiSignIn,
  signOut as apiSignOut,
  OFFLINE,
  type ServerSession,
} from '@/engine/server/session'
import { STORAGE_MODE, type ProjectBackend, type StorageMode } from '@/engine/project/backend'
import { localBackend } from '@/engine/project/localBackend'
import { remoteBackend } from '@/engine/project/remoteBackend'
import type { LibraryBackend } from '@/engine/library/backend'
import { localLibrary } from '@/engine/library/localLibrary'
import { clearRemoteLibraryCache, remoteLibrary } from '@/engine/library/remoteLibrary'

export interface SessionState {
  session: ServerSession
  checked: boolean
  busy: boolean
  error: string | null

  check: () => Promise<void>
  signIn: (username: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set) => ({
  session: OFFLINE,
  checked: false,
  busy: false,
  error: null,

  check: async () => {
    if (!serverAvailable()) {
      set({ session: OFFLINE, checked: true })
      return
    }
    set({ busy: true })
    const session = await fetchSession()
    clearRemoteLibraryCache()
    set({ session, checked: true, busy: false })
  },

  signIn: async (username, password) => {
    set({ busy: true, error: null })
    try {
      const session = await apiSignIn(username, password)
      clearRemoteLibraryCache()
      set({ session, busy: false })
      return true
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  },

  signOut: async () => {
    set({ busy: true })
    try {
      const session = await apiSignOut()
      clearRemoteLibraryCache()
      set({ session, busy: false, error: null })
    } catch {
      // Signing out that fails still means this browser should stop acting
      // signed in.
      set({ session: { ...OFFLINE, available: true }, busy: false })
    }
  },
}))

/** True when work is being kept on a server rather than in this browser. */
export function isSynced(session: ServerSession): boolean {
  return session.available && session.authenticated
}

export function storageMode(session: ServerSession): StorageMode {
  return isSynced(session) ? STORAGE_MODE.Server : STORAGE_MODE.Local
}

export function projectBackendFor(session: ServerSession): ProjectBackend {
  return isSynced(session) ? remoteBackend : localBackend
}

export function libraryBackendFor(session: ServerSession): LibraryBackend {
  return isSynced(session) ? remoteLibrary : localLibrary
}

/** The backend for the session as it stands right now. */
export function currentProjectBackend(): ProjectBackend {
  return projectBackendFor(useSessionStore.getState().session)
}

export function currentLibraryBackend(): LibraryBackend {
  return libraryBackendFor(useSessionStore.getState().session)
}
