import { useCallback, useEffect, useState } from 'react'

export const ACCEPTED_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.ttc'] as const

export function hasFontExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * Window-level drag/drop so a font can be dropped anywhere in the app,
 * not only onto the empty-state panel.
 */
export function useFontDrop(onFile: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      // Only fonts. Dropping a photograph on the window must not tear down
      // the open document, and other drop targets -- the reference image
      // dialog, for one -- need their files left alone.
      if (file && hasFontExtension(file.name)) onFile(file)
    },
    [onFile],
  )

  useEffect(() => {
    let depth = 0
    const onDragEnter = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      depth += 1
      setDragging(true)
    }
    const onDragLeave = (): void => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const onDropEvent = (event: DragEvent): void => {
      depth = 0
      handleDrop(event)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDropEvent)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDropEvent)
    }
  }, [handleDrop])

  return dragging
}

/** Opens the OS file picker and returns the chosen font file. */
export function pickFontFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPTED_EXTENSIONS.join(',')
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
