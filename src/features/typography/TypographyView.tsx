import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Columns2, Sun, Moon } from 'lucide-react'
import type { LayoutOptions } from '@/engine/typography/layout'
import { IconButton } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { Segmented } from '@/components/ui/Segmented'
import { useFontStore } from '@/store/fontStore'
import { cn } from '@/utils/cn'
import { DEFAULT_PRESET, PRESETS } from './presets'
import { TextRender } from './TextRender'

type Background = 'page' | 'inverted'

/**
 * The typography playground.
 *
 * The comparison view renders the imported font and the edited font from the
 * same layout, split by a draggable divider, so a change can be judged in
 * running text rather than one glyph at a time.
 */
export function TypographyView() {
  const parsed = useFontStore((s) => s.parsed)
  const edits = useFontStore((s) => s.edits)
  const kerningEdits = useFontStore((s) => s.kerningEdits)

  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id)
  const [text, setText] = useState(DEFAULT_PRESET.text)
  const [fontSize, setFontSize] = useState(DEFAULT_PRESET.fontSize)
  const [lineHeight, setLineHeight] = useState(DEFAULT_PRESET.lineHeight)
  const [tracking, setTracking] = useState(DEFAULT_PRESET.tracking)
  const [align, setAlign] = useState(DEFAULT_PRESET.align)
  const [columnWidth, setColumnWidth] = useState(DEFAULT_PRESET.columnWidth)
  const [background, setBackground] = useState<Background>('page')
  const [compare, setCompare] = useState(false)
  const [split, setSplit] = useState(0.5)

  const stageRef = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(0)

  useLayoutEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setStageWidth(entry.contentRect.width),
    )
    observer.observe(element)
    setStageWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const applyPreset = (id: string): void => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    setPresetId(id)
    setText(preset.text)
    setFontSize(preset.fontSize)
    setLineHeight(preset.lineHeight)
    setTracking(preset.tracking)
    setAlign(preset.align)
    setColumnWidth(preset.columnWidth)
  }

  const options: LayoutOptions = useMemo(
    () => ({ lineHeight, tracking, align, kerning: true, ligatures: true }),
    [lineHeight, tracking, align],
  )

  const hasEdits =
    Object.keys(edits).length > 0 || Object.keys(kerningEdits).length > 0
  // Comparison is meaningless with nothing to compare, so it is derived
  // rather than stored and corrected afterwards.
  const comparing = compare && hasEdits

  if (!parsed) return null

  const measure =
    columnWidth > 0 ? Math.min(columnWidth, stageWidth) : stageWidth

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                presetId === preset.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-elevated text-ink-muted hover:bg-hover hover:text-ink',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <IconButton
          label={background === 'page' ? 'Dark background' : 'Light background'}
          active={background === 'inverted'}
          onClick={() =>
            setBackground(background === 'page' ? 'inverted' : 'page')
          }
        >
          {background === 'page' ? <Moon size={13} /> : <Sun size={13} />}
        </IconButton>
        <IconButton
          label={
            hasEdits
              ? 'Compare original with modified'
              : 'Nothing edited yet to compare'
          }
          active={comparing}
          disabled={!hasEdits}
          onClick={() => setCompare((v) => !v)}
        >
          <Columns2 size={13} />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-3 py-2">
        <Control label="Size">
          <NumberInput
            ariaLabel="Font size"
            value={fontSize}
            min={4}
            max={400}
            onChange={setFontSize}
            suffix="px"
            className="w-20"
          />
        </Control>
        <Control label="Line height">
          <NumberInput
            ariaLabel="Line height"
            value={lineHeight}
            precision={2}
            step={0.05}
            min={0.5}
            max={4}
            onChange={setLineHeight}
            className="w-16"
          />
        </Control>
        <Control label="Tracking">
          <NumberInput
            ariaLabel="Tracking"
            value={tracking}
            step={5}
            min={-200}
            max={500}
            onChange={setTracking}
            suffix="/1000"
            className="w-24"
          />
        </Control>
        <Control label="Column">
          <NumberInput
            ariaLabel="Column width"
            value={columnWidth}
            step={20}
            min={0}
            max={2000}
            onChange={setColumnWidth}
            suffix="px"
            className="w-20"
          />
        </Control>
        <Segmented
          value={align}
          onChange={setAlign}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'right', label: 'Right' },
          ]}
        />
      </div>

      <div
        ref={stageRef}
        className={cn(
          'relative min-h-0 flex-1 overflow-auto p-8',
          background === 'inverted'
            ? 'bg-ink text-base'
            : 'bg-panel text-ink',
        )}
      >
        <div style={{ width: measure > 0 ? measure : undefined }}>
          {comparing ? (
            <CompareStage
              split={split}
              onSplit={setSplit}
              before={
                <TextRender
                  parsed={parsed}
                  edits={{}}
                  kerningEdits={{}}
                  text={text}
                  fontSize={fontSize}
                  options={options}
                  width={measure}
                />
              }
              after={
                <TextRender
                  parsed={parsed}
                  edits={edits}
                  kerningEdits={kerningEdits}
                  text={text}
                  fontSize={fontSize}
                  options={options}
                  width={measure}
                />
              }
            />
          ) : (
            <TextRender
              parsed={parsed}
              edits={edits}
              kerningEdits={kerningEdits}
              text={text}
              fontSize={fontSize}
              options={options}
              width={measure}
            />
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line px-3 py-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          spellCheck={false}
          className="w-full resize-none rounded-md border border-line bg-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
          placeholder="Type anything…"
        />
        <p className="mt-1 text-[10px] text-ink-faint">
          Rendered from the font's own outlines with its kerning and standard
          ligatures. Complex scripts are not shaped.
        </p>
      </div>
    </div>
  )
}

function Control({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-2xs text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

/** Draggable split between the original and the modified rendering. */
function CompareStage({
  split,
  onSplit,
  before,
  after,
}: {
  split: number
  onSplit: (value: number) => void
  before: React.ReactNode
  after: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const container = ref.current
    if (!container) return
    const move = (e: PointerEvent): void => {
      const rect = container.getBoundingClientRect()
      onSplit(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={ref} className="relative select-none">
      {/* The original underneath, the modified clipped on top. */}
      <div className="opacity-45">{before}</div>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
      >
        {after}
      </div>

      <div
        onPointerDown={onPointerDown}
        className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-col-resize"
        style={{ left: `${split * 100}%` }}
      >
        <div className="mx-auto h-full w-px bg-accent" />
        <div className="absolute top-1/2 left-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-accent bg-panel">
          <Columns2 size={10} className="text-accent" />
        </div>
      </div>

      <div className="pointer-events-none absolute -top-6 left-0 font-mono text-[10px] text-accent">
        modified
      </div>
      <div className="pointer-events-none absolute -top-6 right-0 font-mono text-[10px] text-ink-faint">
        original
      </div>
    </div>
  )
}
