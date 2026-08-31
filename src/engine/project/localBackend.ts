/**
 * Projects in this browser, via IndexedDB.
 *
 * The original storage layer, wrapped to the shared interface. It remains
 * the default: it needs no account, no network and no server, and the font
 * never leaves the machine.
 */
import type { GlyphEdits } from '@/types/font'
import {
  createProject,
  deleteProject,
  listProjects,
  listVersions,
  loadProject,
  saveVersion,
  updateProject,
  type ProjectRecord,
  type ProjectSummary,
  type VersionRecord,
} from './storage'
import {
  STORAGE_MODE,
  type CreateProjectInput,
  type ProjectBackend,
  type UpdateProjectInput,
} from './backend'

export const localBackend: ProjectBackend = {
  mode: STORAGE_MODE.Local,

  list(): Promise<ProjectSummary[]> {
    return listProjects()
  },

  load(id: string): Promise<ProjectRecord | null> {
    return loadProject(id)
  },

  create(input: CreateProjectInput): Promise<ProjectRecord> {
    return createProject({
      name: input.name,
      fontFileName: input.fontFileName,
      fontBytes: input.fontBytes,
      edits: input.edits,
      kerningEdits: input.kerningEdits,
    })
  },

  async update(
    id: string,
    changes: UpdateProjectInput,
  ): Promise<ProjectSummary | null> {
    const record = await updateProject(id, changes)
    if (!record) return null
    const { fontBytes: _bytes, edits, kerningEdits, ...summary } = record
    return {
      ...summary,
      editedGlyphs: Object.keys(edits).length + Object.keys(kerningEdits).length,
    }
  },

  remove(id: string): Promise<void> {
    return deleteProject(id)
  },

  saveVersion(
    projectId: string,
    label: string,
    edits: GlyphEdits,
    kerningEdits: Record<string, number>,
  ): Promise<VersionRecord> {
    return saveVersion(projectId, label, edits, kerningEdits)
  },

  listVersions(projectId: string): Promise<VersionRecord[]> {
    return listVersions(projectId)
  },
}
