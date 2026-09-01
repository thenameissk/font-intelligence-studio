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
  /** Which part of each glyph the pending change applies to. */
  scope: EditScope
  /** Glyph indices the preview applies to. */
  targets: number[]

  setSpec: (spec: TransformSpec | null, targets: number[]) => void
  setScope: (scope: EditScope) => void
  updateSpec: (spec: TransformSpec) => void
  clear: () => void
}

export const useTransformStore = create<TransformState>((set) => ({
  spec: null,
  scope: WHOLE_GLYPH,
  targets: [],

  setSpec: (spec, targets) => set({ spec, targets }),
  setScope: (scope) => set({ scope }),
  updateSpec: (spec) => set({ spec }),
  // The scope survives a cleared preview: having chosen to work on the
  // descender, you are probably about to make another change to it.
  clear: () => set({ spec: null, targets: [] }),
}))
