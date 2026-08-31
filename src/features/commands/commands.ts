/**
 * The command registry behind the command palette.
 *
 * Commands are plain data so the palette, the keyboard layer and (later) an
 * assistant can all drive the same set of actions rather than each reaching
 * into stores on their own.
 */
import type { ResolvedGlyph } from '@/types/font'
import { applyTransformSpec, describeSpec, type TransformSpec } from '@/engine/transforms/applySpec'
import { removeOverlap, hasOverlap } from '@/engine/geometry/boolean'
import { suggestVariants } from '@/engine/analysis/variants'
import { simplifyOutline } from '@/engine/geometry/simplify'
import {
  alignNodes,
  averageNodes,
  deleteContours,
  reverseContours,
  NODE_ALIGN,
} from '@/engine/geometry/pathOps'
import { EDIT_TOOL, useEditorStore } from '@/store/editorStore'
import { useFontStore } from '@/store/fontStore'
import { useHistoryStore } from '@/store/historyStore'
import { useProjectStore } from '@/store/projectStore'
import { useTransformStore } from '@/store/transformStore'
import { useUiStore, WORKSPACE } from '@/store/uiStore'

export interface Command {
  id: string
  title: string
  group: string
  hint?: string
  shortcut?: string
  /** Hidden when this returns false. */
  available?: () => boolean
  run: () => void
}

function requireSelection(): number[] {
  return useEditorStore.getState().selectedGlyphs
}

/** Stages a transformation as a preview rather than applying it blind. */
function preview(spec: TransformSpec): void {
  const targets = requireSelection()
  if (targets.length === 0) return
  useTransformStore.getState().setSpec(spec, targets)
  useUiStore.getState().setWorkspace(WORKSPACE.Glyphs)
}

/** Applies a transformation immediately, as one undoable command. */
function applyNow(
  spec: TransformSpec,
  glyphs: readonly ResolvedGlyph[],
): void {
  const changes = applyTransformSpec(glyphs, spec)
  if (Object.keys(changes).length > 0) {
    useHistoryStore.getState().commit(describeSpec(spec), changes)
  }
}

export function buildCommands(
  resolve: (indices: readonly number[]) => ResolvedGlyph[],
): Command[] {
  const hasFont = (): boolean => useFontStore.getState().parsed !== null
  const hasSelection = (): boolean =>
    hasFont() && useEditorStore.getState().selectedGlyphs.length > 0

  const ui = (): ReturnType<typeof useUiStore.getState> => useUiStore.getState()

  return [
    {
      id: 'analyze',
      title: 'Analyze font',
      group: 'Workspace',
      hint: 'Font DNA, metrics and coverage',
      available: hasFont,
      run: () => ui().setWorkspace(WORKSPACE.Analyzer),
    },
    {
      id: 'dna',
      title: 'Show Font DNA',
      group: 'Workspace',
      available: hasFont,
      run: () => ui().setWorkspace(WORKSPACE.Analyzer),
    },
    {
      id: 'glyphs',
      title: 'Open glyph editor',
      group: 'Workspace',
      available: hasFont,
      run: () => ui().setWorkspace(WORKSPACE.Glyphs),
    },
    {
      id: 'qa',
      title: 'Run font QA',
      group: 'Workspace',
      hint: 'Check every glyph for defects',
      available: hasFont,
      run: () => ui().setWorkspace(WORKSPACE.Validation),
    },
    {
      id: 'kerning',
      title: 'Open kerning',
      group: 'Workspace',
      available: hasFont,
      run: () => ui().setWorkspace(WORKSPACE.Kerning),
    },
    {
      id: 'typography',
      title: 'Typography preview',
      group: 'Workspace',
      available: hasFont,
      run: () => ui().setWorkspace(WORKSPACE.Typography),
    },

    {
      id: 'width-up',
      title: 'Increase width 5%',
      group: 'Transform',
      hint: 'Preview on the selected glyphs',
      available: hasSelection,
      run: () =>
        preview({
          kind: 'scale',
          sx: 1.05,
          sy: 1,
          origin: 'baseline',
          scaleAdvance: true,
        }),
    },
    {
      id: 'width-down',
      title: 'Decrease width 5%',
      group: 'Transform',
      available: hasSelection,
      run: () =>
        preview({
          kind: 'scale',
          sx: 0.95,
          sy: 1,
          origin: 'baseline',
          scaleAdvance: true,
        }),
    },
    {
      id: 'round-corners',
      title: 'Round corners',
      group: 'Transform',
      hint: 'Fillet every corner on the selection',
      available: hasSelection,
      run: () => preview({ kind: 'roundCorners', radius: 20, minAngle: 25 }),
    },
    {
      id: 'thicken',
      title: 'Thicken strokes',
      group: 'Transform',
      available: hasSelection,
      run: () => preview({ kind: 'offset', distance: 8 }),
    },
    {
      id: 'thin',
      title: 'Thin strokes',
      group: 'Transform',
      available: hasSelection,
      run: () => preview({ kind: 'offset', distance: -8 }),
    },
    {
      id: 'slant',
      title: 'Slant 10°',
      group: 'Transform',
      available: hasSelection,
      run: () => preview({ kind: 'slant', degrees: 10 }),
    },
    {
      id: 'normalise-spacing',
      title: 'Normalise spacing',
      group: 'Transform',
      hint: 'Move side bearings towards the selection average',
      available: hasSelection,
      run: () =>
        preview({ kind: 'spacing', rule: { mode: 'average', strength: 1 } }),
    },
    {
      id: 'revert-glyph',
      title: 'Revert selected glyphs',
      group: 'Transform',
      available: () =>
        hasSelection() &&
        requireSelection().some(
          (index) => useFontStore.getState().edits[index] !== undefined,
        ),
      run: () => {
        const changes: Record<number, null> = {}
        for (const index of requireSelection()) changes[index] = null
        useHistoryStore.getState().commit('Revert glyphs', changes)
      },
    },
    {
      id: 'flip-h',
      title: 'Flip horizontally',
      group: 'Transform',
      available: hasSelection,
      run: () => {
        const glyphs = resolve(requireSelection())
        applyNow({ kind: 'flip', axis: 'horizontal' }, glyphs)
      },
    },

    {
      id: 'remove-overlap',
      title: 'Remove overlap',
      group: 'Path',
      hint: 'Merge overlapping contours into one clean outline',
      available: () => {
        const glyphs = resolve(requireSelection())
        return glyphs.length === 1 && !glyphs[0].isEmpty && hasOverlap(glyphs[0].outline)
      },
      run: () => {
        const [glyph] = resolve(requireSelection())
        if (!glyph) return
        useHistoryStore.getState().commit('Remove overlap', {
          [glyph.index]: {
            outline: removeOverlap(glyph.outline),
            advanceWidth: glyph.advanceWidth,
          },
        })
      },
    },
    {
      id: 'simplify',
      title: 'Simplify path',
      group: 'Path',
      hint: 'Fit fewer curves through the same shape',
      available: () => resolve(requireSelection()).some((g) => !g.isEmpty),
      run: () => {
        const glyphs = resolve(requireSelection()).filter((g) => !g.isEmpty)
        if (glyphs.length === 0) return
        const changes: Record<number, { outline: ReturnType<typeof simplifyOutline>; advanceWidth: number }> = {}
        for (const glyph of glyphs) {
          changes[glyph.index] = {
            outline: simplifyOutline(glyph.outline, { tolerance: 1 }),
            advanceWidth: glyph.advanceWidth,
          }
        }
        useHistoryStore.getState().commit('Simplify path', changes)
      },
    },
    {
      id: 'reverse-direction',
      title: 'Reverse contour direction',
      group: 'Path',
      available: () => resolve(requireSelection()).some((g) => !g.isEmpty),
      run: () => {
        const [glyph] = resolve(requireSelection())
        if (!glyph || glyph.isEmpty) return
        const selected = useEditorStore.getState().selectedContours
        const ids =
          selected.length > 0
            ? selected
            : glyph.outline.contours.map((contour) => contour.id)
        useHistoryStore.getState().commit('Reverse direction', {
          [glyph.index]: {
            outline: reverseContours(glyph.outline, ids),
            advanceWidth: glyph.advanceWidth,
          },
        })
      },
    },
    {
      id: 'average-anchors',
      title: 'Average selected anchors',
      group: 'Path',
      hint: 'Collapse the selected anchors onto their shared centre',
      available: () => useEditorStore.getState().selectedNodes.length >= 2,
      run: () => {
        const [glyph] = resolve(requireSelection())
        if (!glyph) return
        useHistoryStore.getState().commit('Average anchors', {
          [glyph.index]: {
            outline: averageNodes(
              glyph.outline,
              useEditorStore.getState().selectedNodes,
              'both',
            ),
            advanceWidth: glyph.advanceWidth,
          },
        })
      },
    },
    {
      id: 'align-anchors-x',
      title: 'Align anchors horizontally',
      group: 'Path',
      available: () => useEditorStore.getState().selectedNodes.length >= 2,
      run: () => {
        const [glyph] = resolve(requireSelection())
        if (!glyph) return
        useHistoryStore.getState().commit('Align anchors', {
          [glyph.index]: {
            outline: alignNodes(
              glyph.outline,
              useEditorStore.getState().selectedNodes,
              NODE_ALIGN.VerticalCenter,
            ),
            advanceWidth: glyph.advanceWidth,
          },
        })
      },
    },
    {
      id: 'delete-contours',
      title: 'Delete selected contours',
      group: 'Path',
      available: () => useEditorStore.getState().selectedContours.length > 0,
      run: () => {
        const [glyph] = resolve(requireSelection())
        if (!glyph) return
        const editor = useEditorStore.getState()
        useHistoryStore.getState().commit('Delete contour', {
          [glyph.index]: {
            outline: deleteContours(glyph.outline, editor.selectedContours),
            advanceWidth: glyph.advanceWidth,
          },
        })
        editor.setSelectedContours([])
      },
    },

    {
      id: 'variants',
      title: 'Suggest letterform variants',
      group: 'Path',
      hint: 'Other forms of this letter that the font itself can supply',
      available: () => {
        const [glyph] = resolve(requireSelection())
        if (!glyph) return false
        const font = useFontStore.getState().parsed
        if (!font) return false
        return suggestVariants(font, useFontStore.getState().edits, glyph.index)
          .length > 0
      },
      run: () => {
        // The suggestions live in the inspector, so make sure it is showing.
        const ui = useUiStore.getState()
        if (!ui.rightPanelOpen) ui.toggleRightPanel()
        ui.setWorkspace(WORKSPACE.Glyphs)
      },
    },

    {
      id: 'reference-image',
      title: 'Use a reference image',
      group: 'Path',
      hint: 'Trace a picture into this glyph, or match its weight and slant',
      available: () => requireSelection().length === 1,
      run: () => {
        const ui = useUiStore.getState()
        if (!ui.rightPanelOpen) ui.toggleRightPanel()
        ui.setWorkspace(WORKSPACE.Glyphs)
      },
    },

    {
      id: 'tool-select',
      title: 'Selection tool',
      group: 'Tools',
      shortcut: 'V',
      run: () => useEditorStore.getState().setTool(EDIT_TOOL.Select),
    },
    {
      id: 'tool-direct',
      title: 'Direct selection tool',
      group: 'Tools',
      shortcut: 'A',
      run: () => useEditorStore.getState().setTool(EDIT_TOOL.Direct),
    },
    {
      id: 'tool-pen',
      title: 'Pen tool',
      group: 'Tools',
      shortcut: 'P',
      run: () => useEditorStore.getState().setTool(EDIT_TOOL.Pen),
    },
    {
      id: 'tool-anchor',
      title: 'Anchor point tool',
      group: 'Tools',
      shortcut: 'C',
      run: () => useEditorStore.getState().setTool(EDIT_TOOL.Anchor),
    },
    {
      id: 'tool-knife',
      title: 'Scissors tool',
      group: 'Tools',
      shortcut: 'K',
      run: () => useEditorStore.getState().setTool(EDIT_TOOL.Knife),
    },

    {
      id: 'undo',
      title: 'Undo',
      group: 'Edit',
      shortcut: '⌘Z',
      available: () => useHistoryStore.getState().past.length > 0,
      run: () => useHistoryStore.getState().undo(),
    },
    {
      id: 'redo',
      title: 'Redo',
      group: 'Edit',
      shortcut: '⇧⌘Z',
      available: () => useHistoryStore.getState().future.length > 0,
      run: () => useHistoryStore.getState().redo(),
    },
    {
      id: 'fit',
      title: 'Fit glyph to view',
      group: 'View',
      shortcut: '0',
      available: hasSelection,
      run: () => useEditorStore.getState().requestFit(),
    },
    {
      id: 'theme',
      title: 'Toggle light / dark',
      group: 'View',
      run: () => ui().toggleTheme(),
    },

    {
      id: 'save',
      title: 'Save project',
      group: 'Project',
      shortcut: '⌘S',
      available: hasFont,
      run: () => void useProjectStore.getState().saveNow(),
    },
    {
      id: 'snapshot',
      title: 'Save a version snapshot',
      group: 'Project',
      available: hasFont,
      run: () =>
        void useProjectStore
          .getState()
          .snapshot(`Version ${new Date().toLocaleTimeString()}`),
    },
    {
      id: 'new',
      title: 'New project',
      group: 'Project',
      run: () => useProjectStore.getState().newProject(),
    },
    {
      id: 'export',
      title: 'Export font',
      group: 'Project',
      shortcut: '⌘E',
      available: hasFont,
      run: () => ui().setExportOpen(true),
    },
  ]
}
