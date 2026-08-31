import { useEffect, useRef, useState } from 'react'
import { cn } from '@/utils/cn'

/**
 * Numeric field with drag-to-scrub, arrow-key stepping and commit-on-blur.
 * Invalid input reverts rather than writing NaN into the font model.
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  disabled = false,
  precision = 0,
  className,
  ariaLabel,
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  disabled?: boolean
  precision?: number
  className?: string
  ariaLabel?: string
}) {
  const format = (v: number): string =>
    Number.isFinite(v) ? v.toFixed(precision) : '0'
  const [draft, setDraft] = useState(() => format(value))
  const [editing, setEditing] = useState(false)
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null)

  useEffect(() => {
    if (!editing) setDraft(format(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, precision])

  const clamp = (v: number): number => {
    let next = v
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    return next
  }

  const commit = (raw: string): void => {
    const parsed = Number.parseFloat(raw.replace(/[^0-9.eE+-]/g, ''))
    if (Number.isFinite(parsed)) onChange(clamp(parsed))
    setDraft(format(Number.isFinite(parsed) ? clamp(parsed) : value))
  }

  const nudge = (direction: number, multiplier: number): void => {
    onChange(clamp(value + direction * step * multiplier))
  }

  return (
    <div
      className={cn(
        'group flex h-6 items-center rounded border border-line bg-input',
        'focus-within:border-accent',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onFocus={(e) => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setEditing(false)
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(format(value))
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            nudge(e.key === 'ArrowUp' ? 1 : -1, multiplier)
          }
          e.stopPropagation()
        }}
        className="h-full w-full min-w-0 bg-transparent px-1.5 font-mono text-2xs tabular text-ink outline-none"
      />
      {suffix && (
        <span
          onPointerDown={(e) => {
            if (disabled) return
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = { startX: e.clientX, startValue: value }
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current
            if (!drag) return
            const delta = Math.round((e.clientX - drag.startX) / 2)
            onChange(clamp(drag.startValue + delta * step))
          }}
          onPointerUp={(e) => {
            dragRef.current = null
            e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          className="cursor-ew-resize px-1.5 text-2xs text-ink-faint select-none"
        >
          {suffix}
        </span>
      )}
    </div>
  )
}
