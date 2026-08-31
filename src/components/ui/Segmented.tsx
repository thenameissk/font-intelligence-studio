import { cn } from '@/utils/cn'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: Array<{ value: T; label: string; title?: string }>
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex h-7 items-center gap-0.5 rounded-md border border-line bg-input p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          title={option.title ?? option.label}
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-6 rounded px-2.5 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-elevated text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
