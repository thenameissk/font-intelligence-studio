import { useEffect } from 'react'
import { TOOL_SHORTCUTS, useEditorStore } from '@/store/editorStore'
import { useHistoryStore } from '@/store/historyStore'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.isContentEditable
  )
}

/**
 * Application-level shortcuts.
 *
 * Canvas-local keys (arrows, delete, space) are handled by the canvas itself
 * so they only apply while a glyph is open.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      const ui = useUiStore.getState()

      // The command menu must open even from inside a text field.
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        ui.setCommandMenuOpen(!ui.commandMenuOpen)
        return
      }
      if (event.key === 'Escape' && ui.commandMenuOpen) {
        ui.setCommandMenuOpen(false)
        return
      }
      if (isTypingTarget(event.target)) return

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        const history = useHistoryStore.getState()
        if (event.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        useHistoryStore.getState().redo()
        return
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void useProjectStore.getState().saveNow()
        return
      }
      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        ui.setExportOpen(true)
        return
      }
      if (mod) return

      const editor = useEditorStore.getState()

      // Single-key tool switching, as in any vector editor.
      const tool = TOOL_SHORTCUTS[event.key.toLowerCase()]
      if (tool && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        editor.setTool(tool)
        return
      }

      switch (event.key) {
        case '+':
        case '=':
          event.preventDefault()
          editor.zoomBy(1.25)
          break
        case '-':
        case '_':
          event.preventDefault()
          editor.zoomBy(1 / 1.25)
          break
        case '0':
          event.preventDefault()
          editor.requestFit()
          break
        case '?':
          event.preventDefault()
          ui.setShortcutsOpen(true)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
