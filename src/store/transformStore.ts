/**
 * The pending (uncommitted) transformation.
 *
 * While a spec is active the canvas, glyph browser and inspector all render
 * the transformed result, but nothing is written to the document until the
 * user applies it -- which is what makes every transformation previewable
 * and cancellable.
 */
import { create } from 'zustand'
import type { TransformSpec } from '@/engine/transforms/applySpec'

export interface TransformState {
  spec: TransformSpec | null
  /** Glyph indices the preview applies to. */
  targets: number[]

  setSpec: (spec: TransformSpec | null, targets: number[]) => void
  updateSpec: (spec: TransformSpec) => void
  clear: () => void
}

export const useTransformStore = create<TransformState>((set) => ({
  spec: null,
  targets: [],

  setSpec: (spec, targets) => set({ spec, targets }),
  updateSpec: (spec) => set({ spec }),
  clear: () => set({ spec: null, targets: [] }),
}))
