/**
 * The pending (uncommitted) transformation.
 *
 * While a spec is active the canvas, glyph browser and inspector all render
 * the transformed result, but nothing is written to the document until the
 * user applies it -- which is what makes every transformation previewable
 * and cancellable.
 */
import { create } from 'zustand'
import { WHOLE_GLYPH, type EditScope } from '@/engine/transforms/scope'
import type { TransformSpec } from '@/engine/transforms/applySpec'

export interface TransformState {
  spec: TransformSpec | null
  /**
   * The last transformation actually applied, so it can be repeated.
   *
   * Repeating is how a series of even steps gets made -- slant one letter by
   * 8 degrees, then give the next five the same 8 degrees rather than typing
   * it again and hoping it matched.
   */
  lastApplied: TransformSpec | null
  /** Which part of each glyph the pending change applies to. */
  scope: EditScope
  /** Glyph indices the preview applies to. */
  targets: number[]

  setSpec: (spec: TransformSpec | null, targets: number[]) => void
  rememberApplied: (spec: TransformSpec) => void
  setScope: (scope: EditScope) => void
  updateSpec: (spec: TransformSpec) => void
  clear: () => void
}

export const useTransformStore = create<TransformState>((set) => ({
  spec: null,
  lastApplied: null,
  scope: WHOLE_GLYPH,
  targets: [],

  setSpec: (spec, targets) => set({ spec, targets }),
  rememberApplied: (spec) => set({ lastApplied: spec }),
  setScope: (scope) => set({ scope }),
  updateSpec: (spec) => set({ spec }),
  // The scope survives a cleared preview: having chosen to work on the
  // descender, you are probably about to make another change to it.
  clear: () => set({ spec: null, targets: [] }),
}))
