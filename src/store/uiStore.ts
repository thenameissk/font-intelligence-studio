/**
 * UI shell state: theme, workspace mode, panel sizing and transient overlays.
 * Deliberately separate from the font document so that opening a panel never
 * invalidates glyph memoisation.
 */
import { create } from 'zustand'

export const WORKSPACE = {
  Glyphs: 'glyphs',
  Analyzer: 'analyzer',
  Typography: 'typography',
  Kerning: 'kerning',
  Validation: 'validation',
} as const
export type Workspace = (typeof WORKSPACE)[keyof typeof WORKSPACE]

export type Theme = 'light' | 'dark'

const THEME_KEY = 'fis.theme'

function readStoredTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export interface UiState {
  theme: Theme
  workspace: Workspace
  leftPanelWidth: number
  rightPanelWidth: number
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  commandMenuOpen: boolean
  exportOpen: boolean
  shortcutsOpen: boolean
  historyOpen: boolean

  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setWorkspace: (workspace: Workspace) => void
  setLeftPanelWidth: (width: number) => void
  setRightPanelWidth: (width: number) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  setCommandMenuOpen: (open: boolean) => void
  setExportOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  toggleHistory: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: readStoredTheme(),
  workspace: WORKSPACE.Glyphs,
  leftPanelWidth: 268,
  rightPanelWidth: 288,
  leftPanelOpen: true,
  rightPanelOpen: true,
  commandMenuOpen: false,
  exportOpen: false,
  shortcutsOpen: false,
  historyOpen: false,

  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Private browsing: the theme simply will not persist.
    }
    set({ theme })
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  setWorkspace: (workspace) => set({ workspace }),
  setLeftPanelWidth: (width) =>
    set({ leftPanelWidth: Math.min(480, Math.max(200, width)) }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.min(480, Math.max(240, width)) }),
  toggleLeftPanel: () => set({ leftPanelOpen: !get().leftPanelOpen }),
  toggleRightPanel: () => set({ rightPanelOpen: !get().rightPanelOpen }),
  setCommandMenuOpen: (commandMenuOpen) => set({ commandMenuOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toggleHistory: () => set({ historyOpen: !get().historyOpen }),
}))
