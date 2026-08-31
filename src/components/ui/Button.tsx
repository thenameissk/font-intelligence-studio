import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'

type Variant = 'default' | 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  default:
    'bg-elevated border border-line text-ink hover:bg-hover active:bg-active',
  primary:
    'bg-accent text-on-accent border border-transparent hover:opacity-90 active:opacity-100',
  ghost:
    'bg-transparent border border-transparent text-ink-muted hover:bg-hover hover:text-ink',
  danger:
    'bg-transparent border border-line text-danger hover:bg-hover',
}

const SIZES: Record<Size, string> = {
  sm: 'h-6 px-2 text-2xs gap-1 rounded',
  md: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children?: ReactNode
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
  children: ReactNode
}

export function IconButton({
  label,
  active = false,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...rest}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        'disabled:pointer-events-none disabled:opacity-35',
        active
          ? 'bg-accent-soft text-accent'
          : 'text-ink-muted hover:bg-hover hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}
