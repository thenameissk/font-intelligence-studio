import {
  FolderOpen,
  Moon,
  PanelLeft,
  PanelRight,
  Redo2,
  Search,
  Sun,
  Undo2,
  Upload,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import {
  displayFamilyName,
  displayStyleName,
} from '@/engine/parser/metadata'
import { pickFontFile } from '@/features/import/useFontDrop'
import { useFontStore } from '@/store/fontStore'
import { useHistoryStore } from '@/store/historyStore'
import { useUiStore, WORKSPACE, type Workspace } from '@/store/uiStore'
import { ProjectMenu } from '@/features/project/ProjectMenu'
import { SessionMenu } from '@/features/session/SessionMenu'

const WORKSPACE_OPTIONS: Array<{ value: Workspace; label: string }> = [
  { value: WORKSPACE.Glyphs, label: 'Glyphs' },
  { value: WORKSPACE.Analyzer, label: 'Analyze' },
  { value: WORKSPACE.Typography, label: 'Type' },
  { value: WORKSPACE.Kerning, label: 'Kern' },
  { value: WORKSPACE.Validation, label: 'QA' },
]

export function Toolbar() {
  const parsed = useFontStore((s) => s.parsed)
  const importFile = useFontStore((s) => s.importFile)
  const modifiedCount = useFontStore((s) => Object.keys(s.edits).length)

  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const workspace = useUiStore((s) => s.workspace)
  const setWorkspace = useUiStore((s) => s.setWorkspace)
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel)
  const toggleRight = useUiStore((s) => s.toggleRightPanel)
  const leftOpen = useUiStore((s) => s.leftPanelOpen)
  const rightOpen = useUiStore((s) => s.rightPanelOpen)
  const setCommandMenuOpen = useUiStore((s) => s.setCommandMenuOpen)
  const setExportOpen = useUiStore((s) => s.setExportOpen)

  const past = useHistoryStore((s) => s.past)
  const future = useHistoryStore((s) => s.future)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  const open = async (): Promise<void> => {
    const file = await pickFontFile()
    if (file) void importFile(file)
  }

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel pr-2 pl-2.5">
      <div className="flex items-center gap-2">
        <Mark />
        <span className="hidden text-xs font-semibold tracking-tight text-ink lg:block">
          Font Intelligence
        </span>
      </div>

      <div className="mx-1 h-4 w-px bg-line" />

      <ProjectMenu />

      <div className="mx-1 h-4 w-px bg-line" />

      <div className="flex min-w-0 items-baseline gap-1.5">
        {parsed ? (
          <>
            <span className="truncate text-xs font-medium text-ink">
              {displayFamilyName(parsed.metadata)}
            </span>
            <span className="truncate text-2xs text-ink-muted">
              {displayStyleName(parsed.metadata)}
            </span>
            {modifiedCount > 0 && (
              <span
                title={`${modifiedCount} glyph${modifiedCount === 1 ? '' : 's'} modified`}
                className="ml-0.5 rounded-sm bg-accent-soft px-1 py-px font-mono text-2xs text-accent"
              >
                {modifiedCount} edited
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-ink-faint">No font open</span>
        )}
      </div>

      <div className="flex-1" />

      {parsed && (
        <Segmented
          value={workspace}
          options={WORKSPACE_OPTIONS}
          onChange={setWorkspace}
        />
      )}

      <div className="flex-1" />

      <IconButton
        label={past.length > 0 ? `Undo ${past[past.length - 1].label} (⌘Z)` : 'Undo (⌘Z)'}
        disabled={past.length === 0}
        onClick={undo}
      >
        <Undo2 size={14} />
      </IconButton>
      <IconButton
        label={future.length > 0 ? `Redo ${future[0].label} (⇧⌘Z)` : 'Redo (⇧⌘Z)'}
        disabled={future.length === 0}
        onClick={redo}
      >
        <Redo2 size={14} />
      </IconButton>

      <div className="mx-1 h-4 w-px bg-line" />

      <IconButton
        label="Command menu (⌘K)"
        onClick={() => setCommandMenuOpen(true)}
      >
        <Search size={14} />
      </IconButton>
      <IconButton
        label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </IconButton>
      <IconButton label="Toggle left panel" active={leftOpen} onClick={toggleLeft}>
        <PanelLeft size={14} />
      </IconButton>
      <IconButton
        label="Toggle inspector"
        active={rightOpen}
        onClick={toggleRight}
      >
        <PanelRight size={14} />
      </IconButton>

      <div className="mx-1 h-4 w-px bg-line" />

      <SessionMenu />

      <Button size="sm" onClick={() => void open()}>
        <FolderOpen size={12} />
        Open
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={!parsed}
        onClick={() => setExportOpen(true)}
      >
        <Upload size={12} />
        Export
      </Button>
    </header>
  )
}

function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="5"
        className="fill-accent"
      />
      <path
        d="M8.4 17.5V6.5h7.6v2.1h-5.2v2.6h4.6v2.1h-4.6v4.2z"
        className="fill-on-accent"
      />
    </svg>
  )
}
