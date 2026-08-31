import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/utils/cn'

export function PanelSection({
  title,
  children,
  actions,
  defaultOpen = true,
  collapsible = true,
  dense = false,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
  defaultOpen?: boolean
  collapsible?: boolean
  dense?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-line last:border-b-0">
      <header className="flex h-8 items-center gap-1 pr-2 pl-1">
        <button
          type="button"
          disabled={!collapsible}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left',
            collapsible && 'hover:bg-hover',
          )}
        >
          {collapsible && (
            <ChevronDown
              size={12}
              className={cn(
                'shrink-0 text-ink-faint transition-transform',
                !open && '-rotate-90',
              )}
            />
          )}
          <span className="truncate text-2xs font-semibold tracking-wide text-ink-muted uppercase">
            {title}
          </span>
        </button>
        {actions}
      </header>
      {open && <div className={cn(dense ? 'pb-2' : 'px-2 pb-3')}>{children}</div>}
    </section>
  )
}

export function Row({
  label,
  children,
  title,
}: {
  label: string
  children: ReactNode
  title?: string
}) {
  return (
    <div className="flex min-h-6 items-center gap-2 py-0.5" title={title}>
      <span className="w-[104px] shrink-0 truncate text-xs text-ink-muted">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-xs text-ink">{children}</div>
    </div>
  )
}

export function Value({
  children,
  mono = false,
  muted = false,
}: {
  children: ReactNode
  mono?: boolean
  muted?: boolean
}) {
  return (
    <span
      data-selectable
      className={cn(
        'block truncate',
        mono && 'font-mono tabular text-2xs',
        muted ? 'text-ink-faint' : 'text-ink',
      )}
    >
      {children}
    </span>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-6 text-center text-xs text-ink-faint">{children}</p>
  )
}
