/**
 * Projects on the server.
 *
 * The font itself is uploaded once, when the project is created, and
 * referenced by URL afterwards. Saving only ever sends the overlay — the
 * edits and kerning — which is what keeps an autosave cheap enough to fire
 * every few seconds even on a three megabyte font.
 */
import type { GlyphEdits } from '@/types/font'
import { request } from '@/engine/server/session'
import type { ProjectRecord, ProjectSummary, VersionRecord } from './storage'
import {
  STORAGE_MODE,
  type CreateProjectInput,
  type ProjectBackend,
  type UpdateProjectInput,
} from './backend'

interface RemoteSummary {
  id: string
  name: string
  fontFileName: string
  fontFamily: string
  fontSize: number
  editedGlyphs: number
  createdAt: number
  updatedAt: number
}

interface RemoteDetail extends RemoteSummary {
  fontUrl: string
  edits: GlyphEdits
  kerningEdits: Record<string, number>
}

interface RemoteVersion {
  id: string
  projectId: string
  label: string
  edits: GlyphEdits
  kerningEdits: Record<string, number>
  editedGlyphs: number
  createdAt: number
}

function toSummary(remote: RemoteSummary): ProjectSummary {
  return {
    id: remote.id,
    name: remote.name,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    fontFileName: remote.fontFileName,
    fontSize: remote.fontSize,
    editedGlyphs: remote.editedGlyphs,
  }
}

/** Fetches the stored font so the project can be reopened and re-parsed. */
async function downloadFont(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`The stored font could not be downloaded (${response.status}).`)
  }
  return response.arrayBuffer()
}

async function toRecord(remote: RemoteDetail): Promise<ProjectRecord> {
  return {
    ...toSummary(remote),
    fontBytes: await downloadFont(remote.fontUrl),
    edits: remote.edits ?? {},
    kerningEdits: remote.kerningEdits ?? {},
  }
}

function toVersion(remote: RemoteVersion): VersionRecord {
  return {
    id: remote.id,
    projectId: remote.projectId,
    label: remote.label,
    edits: remote.edits ?? {},
    kerningEdits: remote.kerningEdits ?? {},
    editedGlyphs: remote.editedGlyphs,
    createdAt: remote.createdAt,
  }
}

export const remoteBackend: ProjectBackend = {
  mode: STORAGE_MODE.Server,

  async list(): Promise<ProjectSummary[]> {
    const body = await request<{ projects: RemoteSummary[] }>('projects/')
    return body.projects.map(toSummary)
  },

  async load(id: string): Promise<ProjectRecord | null> {
    try {
      return await toRecord(await request<RemoteDetail>(`projects/${id}/`))
    } catch (error) {
      // A project that is gone is not an error the caller has to handle
      // differently from one that never existed.
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return null
      }
      throw error
    }
  },

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const form = new FormData()
    form.set('name', input.name)
    form.set('fontFamily', input.fontFamily ?? '')
    form.set(
      'font',
      new Blob([input.fontBytes], { type: 'font/otf' }),
      input.fontFileName,
    )
    form.set('edits', JSON.stringify(input.edits))
    form.set('kerningEdits', JSON.stringify(input.kerningEdits))

    const created = await request<RemoteDetail>('projects/', {
      method: 'POST',
      body: form,
    })
    // The bytes were just uploaded, so there is no sense downloading them
    // straight back.
    return {
      ...toSummary(created),
      fontBytes: input.fontBytes,
      edits: created.edits ?? {},
      kerningEdits: created.kerningEdits ?? {},
    }
  },

  async update(
    id: string,
    changes: UpdateProjectInput,
  ): Promise<ProjectSummary | null> {
    const updated = await request<RemoteDetail>(`projects/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    })
    // Summary only. The font is already in the browser and unchanged, so
    // downloading it back on every autosave would be pure waste.
    return toSummary(updated)
  },

  async remove(id: string): Promise<void> {
    await request(`projects/${id}/`, { method: 'DELETE' })
  },

  async saveVersion(
    projectId: string,
    label: string,
    edits: GlyphEdits,
    kerningEdits: Record<string, number>,
  ): Promise<VersionRecord> {
    return toVersion(
      await request<RemoteVersion>(`projects/${projectId}/versions/`, {
        method: 'POST',
        body: JSON.stringify({ label, edits, kerningEdits }),
      }),
    )
  },

  async listVersions(projectId: string): Promise<VersionRecord[]> {
    const body = await request<{ versions: RemoteVersion[] }>(
      `projects/${projectId}/versions/`,
    )
    return body.versions.map(toVersion)
  },
}
