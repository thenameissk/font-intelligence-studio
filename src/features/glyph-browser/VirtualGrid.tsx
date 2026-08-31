import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Windowed grid.
 *
 * Only the rows intersecting the viewport are mounted, so a 4,000 glyph font
 * renders about sixty cells. Written by hand rather than pulled in as a
 * dependency because the grid is uniform and the logic is a dozen lines.
 */
export function VirtualGrid({
  itemCount,
  cellWidth,
  cellHeight,
  gap = 2,
  overscanRows = 3,
  scrollToIndex,
  renderItem,
  empty,
}: {
  itemCount: number
  cellWidth: number
  cellHeight: number
  gap?: number
  overscanRows?: number
  /** Index to bring into view when it changes. */
  scrollToIndex?: number | null
  renderItem: (index: number) => ReactNode
  empty?: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  const stride = cellWidth + gap
  const columns = Math.max(1, Math.floor((size.width + gap) / stride))
  const rows = Math.ceil(itemCount / columns)
  const rowHeight = cellHeight + gap
  const totalHeight = rows * rowHeight

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows)
  const visibleRows = Math.ceil(size.height / rowHeight) + overscanRows * 2
  const lastRow = Math.min(rows, firstRow + visibleRows)

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  useEffect(() => {
    if (scrollToIndex === null || scrollToIndex === undefined) return
    const element = containerRef.current
    if (!element || columns === 0) return
    const row = Math.floor(scrollToIndex / columns)
    const top = row * rowHeight
    const bottom = top + rowHeight
    if (top < element.scrollTop || bottom > element.scrollTop + element.clientHeight) {
      element.scrollTo({
        top: Math.max(0, top - element.clientHeight / 2 + rowHeight / 2),
        behavior: 'smooth',
      })
    }
  }, [scrollToIndex, columns, rowHeight])

  const items: ReactNode[] = []
  if (size.width > 0) {
    for (let row = firstRow; row < lastRow; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column
        if (index >= itemCount) break
        items.push(
          <div
            key={index}
            style={{
              position: 'absolute',
              transform: `translate(${column * stride}px, ${row * rowHeight}px)`,
              width: cellWidth,
              height: cellHeight,
            }}
          >
            {renderItem(index)}
          </div>,
        )
      }
    }
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="relative h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
    >
      {itemCount === 0 ? (
        empty
      ) : (
        <div style={{ height: totalHeight, position: 'relative' }}>{items}</div>
      )}
    </div>
  )
}
