import { lazy, Suspense, useCallback, useEffect } from 'react'
import { GlyphBrowser } from '@/features/glyph-browser/GlyphBrowser'
import { WorkspaceCenter, WorkspaceInspector } from './Workspace'
import { ImportScreen } from '@/features/import/ImportScreen'
import { useFontDrop } from '@/features/import/useFontDrop'
import { useFontStore } from '@/store/fontStore'
import { useUiStore } from '@/store/uiStore'
import { Resizer } from '@/components/ui/Resizer'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { DropOverlay } from './DropOverlay'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useAutosave } from '@/features/project/useAutosave'
const ExportDialog = lazy(() =>
  import('@/features/export/ExportDialog').then((m) => ({
    default: m.ExportDialog,
  })),
)
import { CommandMenu } from '@/features/commands/CommandMenu'
import { HistoryPanel } from '@/features/project/HistoryPanel'
import { ShortcutsDialog } from './ShortcutsDialog'

export function App() {
  const status = useFontStore((s) => s.status)
  const parsed = useFontStore((s) => s.parsed)
  const importFile = useFontStore((s) => s.importFile)

  const leftOpen = useUiStore((s) => s.leftPanelOpen)
  const rightOpen = useUiStore((s) => s.rightPanelOpen)
  const leftWidth = useUiStore((s) => s.leftPanelWidth)
  const rightWidth = useUiStore((s) => s.rightPanelWidth)
  const setLeftWidth = useUiStore((s) => s.setLeftPanelWidth)
  const setRightWidth = useUiStore((s) => s.setRightPanelWidth)
  const exportOpen = useUiStore((s) => s.exportOpen)
  const setExportOpen = useUiStore((s) => s.setExportOpen)

  const onFile = useCallback(
    (file: File) => {
      void importFile(file)
    },
    [importFile],
  )
  const dragging = useFontDrop(onFile)
  useKeyboardShortcuts()
  useAutosave()

  const importUrl = useFontStore((s) => s.importUrl)
  useEffect(() => {
    // Dev convenience: ?font=/dev-fonts/ArialBlack.ttf loads a fixture on
    // boot. The route only exists in the dev server.
    if (!import.meta.env.DEV) return
    const url = new URLSearchParams(window.location.search).get('font')
    if (url) void importUrl(url)
  }, [importUrl])

  // The canvas must never be squeezed to nothing. Only the inspector folds
  // away automatically: the glyph browser is how a glyph gets chosen, so
  // hiding it would leave the window with nothing to act on.
  useEffect(() => {
    const MIN_CANVAS = 380
    const apply = (): void => {
      const ui = useUiStore.getState()
      const room = window.innerWidth - ui.leftPanelWidth
      if (room - ui.rightPanelWidth < MIN_CANVAS && ui.rightPanelOpen) {
        ui.toggleRightPanel()
      } else if (room - ui.rightPanelWidth >= MIN_CANVAS && !ui.rightPanelOpen) {
        ui.toggleRightPanel()
      }
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-base text-ink">
      <Toolbar />

      {parsed === null ? (
        <div className="min-h-0 flex-1">
          <ImportScreen dragging={dragging} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {leftOpen && (
            <>
              <aside
                style={{ width: leftWidth }}
                className="flex shrink-0 flex-col overflow-hidden border-r border-line bg-panel"
              >
                <GlyphBrowser />
              </aside>
              <Resizer
                side="left"
                currentWidth={leftWidth}
                onResize={setLeftWidth}
              />
            </>
          )}

          <main className="min-w-0 flex-1 overflow-hidden">
            <WorkspaceCenter parsed={parsed} />
          </main>

          {rightOpen && (
            <>
              <Resizer
                side="right"
                currentWidth={rightWidth}
                onResize={setRightWidth}
              />
              <aside
                style={{ width: rightWidth }}
                className="flex shrink-0 flex-col overflow-hidden border-l border-line bg-panel"
              >
                <WorkspaceInspector parsed={parsed} />
              </aside>
            </>
          )}
        </div>
      )}

      <HistoryPanel />
      <StatusBar />
      <CommandMenu />
      <ShortcutsDialog />
      {exportOpen && parsed && (
        <Suspense fallback={null}>
          <ExportDialog onClose={() => setExportOpen(false)} />
        </Suspense>
      )}
      {dragging && parsed !== null && <DropOverlay />}
      {status === 'loading' && parsed !== null && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center bg-base/60">
          <span className="rounded-md border border-line bg-elevated px-3 py-1.5 text-xs text-ink">
            Parsing font…
          </span>
        </div>
      )}
    </div>
  )
}
