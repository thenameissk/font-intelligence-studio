/**
 * Project persistence in IndexedDB.
 *
 * A project stores the imported font bytes once, plus the edit overlay.
 * Versions store only the overlay, so a hundred saved versions of a 3 MB
 * font cost kilobytes rather than hundreds of megabytes -- which is the
 * whole point of keeping edits sparse.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { GlyphEdits } from '@/types/font'
import { createId } from '@/utils/id'

export interface ProjectRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  fontFileName: string
  fontSize: number
  /** The exact imported bytes, so a project reopens as the original font. */
  fontBytes: ArrayBuffer
  edits: GlyphEdits
  kerningEdits: Record<string, number>
}

export interface VersionRecord {
  id: string
  projectId: string
  createdAt: number
  label: string
  /** Only the overlay: the font bytes live once, on the project. */
  edits: GlyphEdits
  kerningEdits: Record<string, number>
  editedGlyphs: number
}

export type ProjectSummary = Omit<ProjectRecord, 'fontBytes' | 'edits' | 'kerningEdits'> & {
  editedGlyphs: number
}

interface Schema extends DBSchema {
  projects: {
    key: string
    value: ProjectRecord
    indexes: { updatedAt: number }
  }
  versions: {
    key: string
    value: VersionRecord
    indexes: { projectId: string }
  }
}

const DB_NAME = 'font-intelligence-studio'
const DB_VERSION = 1
const MAX_VERSIONS_PER_PROJECT = 50

let database: Promise<IDBPDatabase<Schema>> | null = null

function db(): Promise<IDBPDatabase<Schema>> {
  if (!database) {
    database = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(instance) {
        const projects = instance.createObjectStore('projects', { keyPath: 'id' })
        projects.createIndex('updatedAt', 'updatedAt')
        const versions = instance.createObjectStore('versions', { keyPath: 'id' })
        versions.createIndex('projectId', 'projectId')
      },
    })
  }
  return database
}

export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export interface CreateProjectInput {
  name: string
  fontFileName: string
  fontBytes: ArrayBuffer
  edits: GlyphEdits
  kerningEdits: Record<string, number>
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectRecord> {
  const now = Date.now()
  const record: ProjectRecord = {
    id: createId('proj'),
    name: input.name,
    createdAt: now,
    updatedAt: now,
    fontFileName: input.fontFileName,
    fontSize: input.fontBytes.byteLength,
    fontBytes: input.fontBytes,
    edits: input.edits,
    kerningEdits: input.kerningEdits,
  }
  await (await db()).put('projects', record)
  return record
}

export async function updateProject(
  id: string,
  changes: {
    name?: string
    edits?: GlyphEdits
    kerningEdits?: Record<string, number>
  },
): Promise<ProjectRecord | null> {
  const instance = await db()
  const existing = await instance.get('projects', id)
  if (!existing) return null

  const updated: ProjectRecord = {
    ...existing,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.edits !== undefined ? { edits: changes.edits } : {}),
    ...(changes.kerningEdits !== undefined
      ? { kerningEdits: changes.kerningEdits }
      : {}),
    updatedAt: Date.now(),
  }
  await instance.put('projects', updated)
  return updated
}

export async function loadProject(id: string): Promise<ProjectRecord | null> {
  return (await (await db()).get('projects', id)) ?? null
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const instance = await db()
  const all = await instance.getAll('projects')
  return all
    .map(({ fontBytes: _bytes, edits, kerningEdits, ...rest }) => ({
      ...rest,
      editedGlyphs: Object.keys(edits).length + Object.keys(kerningEdits).length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(id: string): Promise<void> {
  const instance = await db()
  await instance.delete('projects', id)
  const versions = await instance.getAllFromIndex('versions', 'projectId', id)
  await Promise.all(versions.map((version) => instance.delete('versions', version.id)))
}

export async function saveVersion(
  projectId: string,
  label: string,
  edits: GlyphEdits,
  kerningEdits: Record<string, number>,
): Promise<VersionRecord> {
  const instance = await db()
  const record: VersionRecord = {
    id: createId('ver'),
    projectId,
    createdAt: Date.now(),
    label,
    edits,
    kerningEdits,
    editedGlyphs: Object.keys(edits).length,
  }
  await instance.put('versions', record)

  // Keep history bounded so a long session cannot fill the user's quota.
  const all = await instance.getAllFromIndex('versions', 'projectId', projectId)
  if (all.length > MAX_VERSIONS_PER_PROJECT) {
    const oldest = all
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, all.length - MAX_VERSIONS_PER_PROJECT)
    await Promise.all(oldest.map((version) => instance.delete('versions', version.id)))
  }

  return record
}

export async function listVersions(
  projectId: string,
): Promise<VersionRecord[]> {
  const instance = await db()
  const all = await instance.getAllFromIndex('versions', 'projectId', projectId)
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function estimateUsage(): Promise<{
  usage: number
  quota: number
} | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null
  }
  const estimate = await navigator.storage.estimate()
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
}
