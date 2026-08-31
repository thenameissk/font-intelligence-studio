import { useCallback } from 'react'
import { cn } from '@/utils/cn'

/** Draggable 1px divider between shell panels. */
export function Resizer({
  onResize,
  side,
  currentWidth,
}: {
  onResize: (width: number) => void
  side: 'left' | 'right'
  currentWidth: number
}) {
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = currentWidth
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)

      const move = (e: PointerEvent): void => {
        const delta = e.clientX - startX
        onResize(side === 'left' ? startWidth + delta : startWidth - delta)
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'col-resize'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [currentWidth, onResize, side],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={cn(
        'relative z-10 w-px shrink-0 cursor-col-resize bg-line',
        'after:absolute after:inset-y-0 after:-left-1 after:w-3 after:content-[""]',
        'hover:bg-accent',
      )}
    />
  )
}
