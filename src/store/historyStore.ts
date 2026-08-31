/**
 * Command-based undo/redo.
 *
 * A command stores only the glyphs it touched, as a before/after pair of
 * sparse edit patches. Undo is applying `before`, redo is applying `after`.
 * Nothing snapshots the whole font, so history stays small even after
 * thousands of operations on a large family.
 *
 * Interactive gestures (dragging a node, scrubbing a metric) open a
 * transaction on pointer-down and commit one command on pointer-up, so a
 * drag is a single undo step rather than a hundred.
 */
import { create } from 'zustand'
import type { GlyphEdit } from '@/types/font'
import { createId } from '@/utils/id'
import { useFontStore } from './fontStore'

/** null means "revert this glyph to the imported original". */
export type EditPatch = Record<number, GlyphEdit | null>
export type KerningPatch = Record<string, number | null>

export interface Command {
  id: string
  label: string
  timestamp: number
  before: EditPatch
  after: EditPatch
  kerningBefore: KerningPatch
  kerningAfter: KerningPatch
  /** Glyph indices touched, for the history panel. */
  glyphs: number[]
}

const MAX_HISTORY = 200

interface Transaction {
  label: string
  before: EditPatch
  kerningBefore: KerningPatch
  touched: Set<number>
  kerningTouched: Set<string>
}

export interface HistoryState {
  past: Command[]
  future: Command[]
  transaction: Transaction | null

  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void
  clear: () => void

  /** One-shot change: applies it and records a command. */
  commit: (
    label: string,
    changes: EditPatch,
    kerningChanges?: KerningPatch,
  ) => void

  begin: (label: string) => void
  /** Applies changes inside an open transaction without recording history. */
  update: (changes: EditPatch, kerningChanges?: KerningPatch) => void
  end: () => void
  abort: () => void
}

function currentEditFor(index: number): GlyphEdit | null {
  return useFontStore.getState().edits[index] ?? null
}

function currentKerningFor(key: string): number | null {
  return useFontStore.getState().kerningEdits[key] ?? null
}

function applyPatches(edits: EditPatch, kerning: KerningPatch): void {
  const font = useFontStore.getState()
  if (Object.keys(edits).length > 0) font.applyGlyphEdits(edits)
  for (const [key, value] of Object.entries(kerning)) {
    const [left, right] = key.split(',').map(Number)
    font.setKerning(left, right, value)
  }
}

function capture(
  indices: Iterable<number>,
  keys: Iterable<string>,
): { edits: EditPatch; kerning: KerningPatch } {
  const edits: EditPatch = {}
  for (const index of indices) edits[index] = currentEditFor(index)
  const kerning: KerningPatch = {}
  for (const key of keys) kerning[key] = currentKerningFor(key)
  return { edits, kerning }
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  transaction: null,

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  undo: () => {
    const { past, future } = get()
    const command = past[past.length - 1]
    if (!command) return
    applyPatches(command.before, command.kerningBefore)
    set({ past: past.slice(0, -1), future: [command, ...future] })
  },

  redo: () => {
    const { past, future } = get()
    const command = future[0]
    if (!command) return
    applyPatches(command.after, command.kerningAfter)
    set({ past: [...past, command], future: future.slice(1) })
  },

  clear: () => set({ past: [], future: [], transaction: null }),

  commit: (label, changes, kerningChanges = {}) => {
    const indices = Object.keys(changes).map(Number)
    const keys = Object.keys(kerningChanges)
    if (indices.length === 0 && keys.length === 0) return

    const before = capture(indices, keys)
    applyPatches(changes, kerningChanges)

    const command: Command = {
      id: createId('cmd'),
      label,
      timestamp: Date.now(),
      before: before.edits,
      after: changes,
      kerningBefore: before.kerning,
      kerningAfter: Object.fromEntries(
        Object.entries(kerningChanges).map(([k, v]) => [k, v]),
      ),
      glyphs: indices,
    }
    set((state) => ({
      past: [...state.past, command].slice(-MAX_HISTORY),
      future: [],
    }))
  },

  begin: (label) => {
    // A stray open transaction would swallow the next edit's history.
    if (get().transaction) get().end()
    set({
      transaction: {
        label,
        before: {},
        kerningBefore: {},
        touched: new Set(),
        kerningTouched: new Set(),
      },
    })
  },

  update: (changes, kerningChanges = {}) => {
    const transaction = get().transaction
    if (!transaction) {
      applyPatches(changes, kerningChanges)
      return
    }
    // Record the pre-gesture value the first time each glyph is touched.
    for (const key of Object.keys(changes)) {
      const index = Number(key)
      if (!transaction.touched.has(index)) {
        transaction.touched.add(index)
        transaction.before[index] = currentEditFor(index)
      }
    }
    for (const key of Object.keys(kerningChanges)) {
      if (!transaction.kerningTouched.has(key)) {
        transaction.kerningTouched.add(key)
        transaction.kerningBefore[key] = currentKerningFor(key)
      }
    }
    applyPatches(changes, kerningChanges)
  },

  end: () => {
    const transaction = get().transaction
    if (!transaction) return
    set({ transaction: null })
    if (transaction.touched.size === 0 && transaction.kerningTouched.size === 0) {
      return
    }

    const after = capture(transaction.touched, transaction.kerningTouched)
    const unchanged =
      [...transaction.touched].every(
        (index) => transaction.before[index] === after.edits[index],
      ) &&
      [...transaction.kerningTouched].every(
        (key) => transaction.kerningBefore[key] === after.kerning[key],
      )
    if (unchanged) return

    const command: Command = {
      id: createId('cmd'),
      label: transaction.label,
      timestamp: Date.now(),
      before: transaction.before,
      after: after.edits,
      kerningBefore: transaction.kerningBefore,
      kerningAfter: after.kerning,
      glyphs: [...transaction.touched],
    }
    set((state) => ({
      past: [...state.past, command].slice(-MAX_HISTORY),
      future: [],
    }))
  },

  abort: () => {
    const transaction = get().transaction
    if (!transaction) return
    applyPatches(transaction.before, transaction.kerningBefore)
    set({ transaction: null })
  },
}))

/** Convenience for components: run a one-shot undoable change. */
export function commitEdits(
  label: string,
  changes: EditPatch,
  kerningChanges?: KerningPatch,
): void {
  useHistoryStore.getState().commit(label, changes, kerningChanges)
}
