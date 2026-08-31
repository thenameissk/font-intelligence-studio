/**
 * The current project: which saved document the session is attached to, and
 * whether it has unsaved changes.
 *
 * Autosave is deliberately shallow -- it writes the edit overlay to the open
 * project record. Version snapshots are explicit, so history stays a list of
 * moments the user chose rather than a stream of keystrokes.
 */
import { create } from 'zustand'
import type { GlyphEdits } from '@/types/font'
import type { VersionRecord } from '@/engine/project/storage'
import { STORAGE_MODE, type StorageMode } from '@/engine/project/backend'
import { currentProjectBackend } from '@/store/sessionStore'
import { useFontStore } from './fontStore'
import { useHistoryStore } from './historyStore'
import { parseFontFile } from '@/engine/parser/parseFont'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface ProjectState {
  projectId: string | null
  projectName: string
  status: SaveStatus
  lastSavedAt: number | null
  error: string | null
  versions: VersionRecord[]
  autosave: boolean
  /** Where the open project is stored. */
  storageMode: StorageMode

  saveNow: (label?: string) => Promise<void>
  snapshot: (label: string) => Promise<void>
  open: (projectId: string) => Promise<void>
  restore: (versionId: string) => Promise<void>
  refreshVersions: () => Promise<void>
  rename: (name: string) => Promise<void>
  newProject: () => void
  setAutosave: (enabled: boolean) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  projectName: 'Untitled project',
  status: 'idle',
  lastSavedAt: null,
  error: null,
  versions: [],
  autosave: true,
  storageMode: STORAGE_MODE.Local,

  saveNow: async () => {
    const font = useFontStore.getState()
    if (!font.parsed) return
    set({ status: 'saving', error: null })
    try {
      const backend = currentProjectBackend()
      const { projectId, storageMode } = get()

      // A project saved locally cannot be patched on the server and the
      // reverse, so a change of storage starts a new record rather than
      // writing to an id the other side has never heard of.
      if (projectId && storageMode === backend.mode) {
        await backend.update(projectId, {
          edits: font.edits,
          kerningEdits: { ...font.kerningEdits },
        })
      } else {
        const record = await backend.create({
          name: get().projectName,
          fontFileName: font.parsed.metadata.fileName,
          fontFamily: font.parsed.metadata.names.fontFamily ?? '',
          // The imported bytes are stored once so the project reopens as
          // the original font, with edits layered back on top.
          fontBytes: font.parsed.originalFile.slice(0),
          edits: font.edits,
          kerningEdits: { ...font.kerningEdits },
        })
        set({ projectId: record.id, projectName: record.name })
      }
      set({
        status: 'saved',
        lastSavedAt: Date.now(),
        storageMode: backend.mode,
      })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  snapshot: async (label) => {
    await get().saveNow()
    const { projectId } = get()
    if (!projectId) return
    const font = useFontStore.getState()
    await currentProjectBackend().saveVersion(projectId, label, font.edits, {
      ...font.kerningEdits,
    })
    await get().refreshVersions()
  },

  open: async (projectId) => {
    set({ status: 'saving', error: null })
    try {
      const backend = currentProjectBackend()
      const record = await backend.load(projectId)
      if (!record) throw new Error('That project no longer exists.')

      const parsed = await parseFontFile({
        name: record.fontFileName,
        buffer: record.fontBytes.slice(0),
      })
      useFontStore.setState({
        status: 'ready',
        parsed,
        edits: record.edits,
        kerningEdits: record.kerningEdits,
        warnings: [...parsed.warnings],
        error: null,
        revision: useFontStore.getState().revision + 1,
      })
      useHistoryStore.getState().clear()
      set({
        projectId: record.id,
        projectName: record.name,
        status: 'saved',
        lastSavedAt: record.updatedAt,
        storageMode: backend.mode,
      })
      await get().refreshVersions()
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  restore: async (versionId) => {
    const version = get().versions.find((v) => v.id === versionId)
    if (!version) return
    // Restoring is itself undoable: it replaces the overlay in one command.
    useHistoryStore.getState().commit(
      `Restore "${version.label}"`,
      buildRestorePatch(useFontStore.getState().edits, version.edits),
      buildKerningPatch(
        useFontStore.getState().kerningEdits,
        version.kerningEdits,
      ),
    )
    await get().saveNow()
  },

  refreshVersions: async () => {
    const { projectId } = get()
    if (!projectId) {
      set({ versions: [] })
      return
    }
    set({ versions: await currentProjectBackend().listVersions(projectId) })
  },

  rename: async (name) => {
    set({ projectName: name })
    const { projectId } = get()
    if (projectId) await currentProjectBackend().update(projectId, { name })
  },

  newProject: () => {
    useFontStore.getState().closeFont()
    useHistoryStore.getState().clear()
    set({
      projectId: null,
      projectName: 'Untitled project',
      status: 'idle',
      lastSavedAt: null,
      versions: [],
      error: null,
      storageMode: currentProjectBackend().mode,
    })
  },

  setAutosave: (autosave) => set({ autosave }),
}))

/** Turns a target overlay into a patch that also clears glyphs it lacks. */
function buildRestorePatch(
  current: GlyphEdits,
  target: GlyphEdits,
): Record<number, GlyphEdits[number] | null> {
  const patch: Record<number, GlyphEdits[number] | null> = {}
  for (const key of Object.keys(current)) patch[Number(key)] = null
  for (const [key, value] of Object.entries(target)) patch[Number(key)] = value
  return patch
}

function buildKerningPatch(
  current: Readonly<Record<string, number>>,
  target: Readonly<Record<string, number>>,
): Record<string, number | null> {
  const patch: Record<string, number | null> = {}
  for (const key of Object.keys(current)) patch[key] = null
  for (const [key, value] of Object.entries(target)) patch[key] = value
  return patch
}
