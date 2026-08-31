/**
 * Where projects live.
 *
 * Two answers, behind one interface: this browser, or a server. The studio
 * itself does not care which — the storage layer is the only part that
 * knows, and the UI says plainly which one is in use so nobody has to
 * guess where their work went.
 *
 * The local backend is the default and always works. The remote one appears
 * only when the page is served by a Django host and somebody is signed in.
 */
import type { GlyphEdits } from '@/types/font'
import type { ProjectRecord, ProjectSummary, VersionRecord } from './storage'

export const STORAGE_MODE = {
  /** IndexedDB in this browser. Nothing leaves the machine. */
  Local: 'local',
  /** A Django server. Shared, and backed up with the rest of your database. */
  Server: 'server',
} as const
export type StorageMode = (typeof STORAGE_MODE)[keyof typeof STORAGE_MODE]

export interface CreateProjectInput {
  name: string
  fontFileName: string
  fontBytes: ArrayBuffer
  fontFamily?: string
  edits: GlyphEdits
  kerningEdits: Record<string, number>
}

export interface UpdateProjectInput {
  name?: string
  edits?: GlyphEdits
  kerningEdits?: Record<string, number>
}

export interface ProjectBackend {
  readonly mode: StorageMode
  list(): Promise<ProjectSummary[]>
  load(id: string): Promise<ProjectRecord | null>
  create(input: CreateProjectInput): Promise<ProjectRecord>
  /**
   * Saves changes and returns the updated summary.
   *
   * Deliberately not the full record: autosave calls this every few seconds
   * and the font bytes never change, so handing them back would mean
   * re-downloading the whole font on every keystroke's worth of edits.
   */
  update(id: string, changes: UpdateProjectInput): Promise<ProjectSummary | null>
  remove(id: string): Promise<void>
  saveVersion(
    projectId: string,
    label: string,
    edits: GlyphEdits,
    kerningEdits: Record<string, number>,
  ): Promise<VersionRecord>
  listVersions(projectId: string): Promise<VersionRecord[]>
}
