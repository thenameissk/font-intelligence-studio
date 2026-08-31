import { memo, useMemo } from 'react'
import type { Specimen } from '@/engine/library/specimen'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import { cn } from '@/utils/cn'

/**
 * One typeface's take on the letter.
 *
 * Every tile is normalised to a shared cap height rather than drawn at its
 * own units-per-em, so the grid compares letterforms instead of comparing
 * how each font happens to define its em.
 */
export const SpecimenTile = memo(function SpecimenTile({
  specimen,
  size = 72,
  selected = false,
  onClick,
}: {
  specimen: Specimen
  size?: number
  selected?: boolean
  onClick?: () => void
}) {
  const path = useMemo(
    () => outlineToSvgPathData(specimen.outline, 1),
    [specimen.outline],
  )

  // Normalise on the letter's own height so an 'a' from a large-x-height
  // face and a small one appear at comparable size.
  const reference =
    specimen.xHeight ?? specimen.capHeight ?? specimen.unitsPerEm * 0.5
  const box = reference * 2.1
  const width = Math.max(specimen.advanceWidth, box * 0.6)

  const viewBox = [
    -(width - specimen.advanceWidth) / 2 - box * 0.06,
    -reference * 1.55,
    width + box * 0.12,
    box,
  ].join(' ')

  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      title={`${specimen.family} ${specimen.style}\n${specimen.label}`}
      className={cn(
        'group flex flex-col items-center gap-1 rounded-md border p-2 text-left transition-colors',
        selected
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-elevated hover:bg-hover',
      )}
    >
      <svg
        viewBox={viewBox}
        style={{ width: size, height: size }}
        className={selected ? 'text-accent' : 'text-ink'}
        aria-label={`${specimen.family} ${specimen.style}`}
      >
        <g transform="scale(1,-1)">
          <path d={path} fill="currentColor" fillRule="nonzero" />
        </g>
      </svg>
      <span className="w-full min-w-0">
        <span className="block truncate text-[10px] font-medium text-ink">
          {specimen.family}
        </span>
        <span className="block truncate text-[9px] text-ink-faint">
          {specimen.label}
        </span>
      </span>
    </Wrapper>
  )
})
