import { useMemo, useState } from 'react'
import { AlertTriangle, Image as ImageIcon, Info, Loader2, Wand2, X } from 'lucide-react'
import type { ResolvedGlyph } from '@/types/font'
import type { ParsedFont } from '@/engine/parser/parseFont'
import { outlineToSvgPathData } from '@/engine/geometry/outline'
import {
  compareProfiles,
  formatAxisValue,
  profileOutline,
} from '@/engine/analysis/styleProfile'
import {
  matchLimitations,
  proposeStyleMatch,
  type StyleProposal,
} from '@/engine/transforms/styleMatch'
import { applyTransformSpec } from '@/engine/transforms/applySpec'
import { HORIZONTAL_FIT, VERTICAL_FIT } from '@/engine/raster/fitToMetrics'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { Segmented } from '@/components/ui/Segmented'
import { useHistoryStore } from '@/store/historyStore'
import { cn } from '@/utils/cn'
import { useImageTrace } from './useImageTrace'

type Mode = 'trace' | 'style'

/**
 * The reference-image workflow.
 *
 * Two separate things can be done with an image, and they are kept apart on
 * purpose because they mean different things: tracing replaces the letter
 * with the one in the picture, style matching keeps this font's letter and
 * moves its weight, slant and proportion towards the picture's.
 */
export function ReferenceDialog({
  parsed,
  glyph,
  onClose,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  onClose: () => void
}) {
  const commit = useHistoryStore((s) => s.commit)
  const [mode, setMode] = useState<Mode>('trace')
  const [dropping, setDropping] = useState(false)
  // Keyed by proposal id. Absent means "use the default for its
  // confidence", so nothing has to be reset when the reference changes and
  // a stale entry for a proposal that no longer exists is harmless.
  const [choices, setChoices] = useState<Record<string, boolean>>({})

  const { state, settings, setSettings, load, clear } = useImageTrace(
    glyph,
    parsed.verticalMetrics,
    parsed.metadata.outlineFormat,
  )

  const currentProfile = useMemo(
    () => profileOutline(glyph.outline),
    [glyph.outline],
  )
  const referenceProfile = useMemo(
    () => (state.raw ? profileOutline(state.raw) : null),
    [state.raw],
  )

  const axes = useMemo(
    () =>
      referenceProfile ? compareProfiles(currentProfile, referenceProfile) : [],
    [currentProfile, referenceProfile],
  )

  const proposals = useMemo(() => {
    if (!referenceProfile || glyph.isEmpty) return []
    return proposeStyleMatch(currentProfile, referenceProfile, {
      glyphHeight: glyph.bounds.yMax - glyph.bounds.yMin,
    })
  }, [currentProfile, referenceProfile, glyph])

  const limitations = useMemo(
    () =>
      referenceProfile ? matchLimitations(currentProfile, referenceProfile) : [],
    [currentProfile, referenceProfile],
  )

  // Anything the engine calls an estimate starts unchecked: a measured
  // change can be trusted to land where it says, an estimated one is a
  // suggestion the designer should look at before taking.
  const isAccepted = (proposal: StyleProposal): boolean =>
    choices[proposal.id] ?? proposal.confidence === 'measured'
  const accepted = proposals.filter(isAccepted)

  const pickFile = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) void load(file)
    })
    input.click()
  }

  const applyTrace = (): void => {
    if (!state.outline) return
    commit(`Trace image into ${glyph.name}`, {
      [glyph.index]: {
        outline: state.outline,
        advanceWidth: state.advanceWidth,
      },
    })
    onClose()
  }

  const applyStyle = (): void => {
    if (accepted.length === 0) return
    // Each proposal is applied to the result of the last, so the set lands
    // as a single undoable step rather than a stack of them.
    let working = glyph
    for (const proposal of accepted) {
      const changes = applyTransformSpec([working], proposal.spec)
      const change = changes[working.index]
      if (!change?.outline) continue
      working = {
        ...working,
        outline: change.outline,
        advanceWidth: change.advanceWidth ?? working.advanceWidth,
      }
    }
    commit(
      `Match style of reference (${accepted.map((p) => p.label.toLowerCase()).join(', ')})`,
      {
        [glyph.index]: {
          outline: working.outline,
          advanceWidth: working.advanceWidth,
        },
      },
    )
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault()
          // Keep the drop from reaching the window-level font importer.
          event.stopPropagation()
          setDropping(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void load(file)
        }}
        className={cn(
          'flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-panel shadow-xl',
          dropping ? 'border-accent' : 'border-line',
        )}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <ImageIcon size={13} className="text-ink-muted" />
          <h2 className="text-xs font-semibold text-ink">
            Reference image · {glyph.name}
          </h2>
          <span className="flex-1" />
          {state.image && (
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'trace', label: 'Trace' },
                { value: 'style', label: 'Match style' },
              ]}
            />
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <X size={13} />
          </button>
        </header>

        {!state.image ? (
          <Dropzone busy={state.busy} error={state.error} onPick={pickFile} />
        ) : (
          <div className="flex min-h-0 flex-1">
            <Preview
              parsed={parsed}
              glyph={glyph}
              state={state}
              mode={mode}
              proposals={accepted}
            />

            <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line p-3">
              {mode === 'trace' ? (
                <TraceControls
                  state={state}
                  settings={settings}
                  setSettings={setSettings}
                />
              ) : (
                <StyleControls
                  axes={axes}
                  proposals={proposals}
                  isAccepted={isAccepted}
                  onToggle={(id, next) =>
                    setChoices((current) => ({ ...current, [id]: next }))
                  }
                  limitations={limitations}
                  glyphEmpty={glyph.isEmpty}
                />
              )}
            </aside>
          </div>
        )}

        <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-3">
          <p className="flex-1 text-2xs text-ink-faint">
            {mode === 'trace'
              ? 'Replaces the outline. The font’s advance width is kept.'
              : 'Adjusts this font’s own letter. Spacing is never changed.'}
          </p>
          {state.image && (
            <Button onClick={clear}>Choose another</Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          {mode === 'trace' ? (
            <Button
              variant="primary"
              disabled={!state.outline || state.busy}
              onClick={applyTrace}
            >
              Trace into glyph
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={accepted.length === 0}
              onClick={applyStyle}
            >
              <Wand2 size={12} />
              Apply {accepted.length} change{accepted.length === 1 ? '' : 's'}
            </Button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Dropzone({
  busy,
  error,
  onPick,
}: {
  busy: boolean
  error: string | null
  onPick: () => void
}) {
  return (
    <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      {busy ? (
        <Loader2 size={26} className="animate-spin text-accent" />
      ) : (
        <ImageIcon size={26} className="text-ink-faint" strokeWidth={1.5} />
      )}
      <p className="text-sm font-medium text-ink">
        Drop an image of a letter
      </p>
      <p className="max-w-sm text-xs text-ink-muted">
        A photograph, a scan or a screenshot. It is traced locally — nothing
        is uploaded. Highest contrast between the letter and its background
        gives the cleanest result.
      </p>
      <Button variant="primary" onClick={onPick} disabled={busy}>
        Choose image
      </Button>
      {error && (
        <p className="mt-1 flex items-center gap-1.5 text-2xs text-danger">
          <AlertTriangle size={11} />
          {error}
        </p>
      )}
    </div>
  )
}

function Preview({
  parsed,
  glyph,
  state,
  mode,
  proposals,
}: {
  parsed: ParsedFont
  glyph: ResolvedGlyph
  state: ReturnType<typeof useImageTrace>['state']
  mode: Mode
  proposals: StyleProposal[]
}) {
  const metrics = parsed.verticalMetrics
  const upm = metrics.unitsPerEm

  // In style mode the preview shows where the proposals would land.
  const previewed = useMemo(() => {
    if (mode !== 'style' || proposals.length === 0) return glyph.outline
    let working = glyph
    for (const proposal of proposals) {
      const change = applyTransformSpec([working], proposal.spec)[working.index]
      if (!change?.outline) continue
      working = { ...working, outline: change.outline }
    }
    return working.outline
  }, [mode, proposals, glyph])

  const currentPath = useMemo(
    () => outlineToSvgPathData(glyph.outline, 1),
    [glyph.outline],
  )
  const tracedPath = useMemo(
    () => (state.outline ? outlineToSvgPathData(state.outline, 1) : null),
    [state.outline],
  )
  const previewPath = useMemo(
    () => outlineToSvgPathData(previewed, 1),
    [previewed],
  )

  const width = Math.max(glyph.advanceWidth, upm * 0.6)
  const viewBox = `${-upm * 0.08} ${-metrics.ascender} ${width + upm * 0.16} ${
    metrics.ascender - metrics.descender
  }`

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex gap-4">
        <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
          <figcaption className="text-2xs text-ink-muted">Reference</figcaption>
          <div className="flex h-44 items-center justify-center overflow-hidden rounded border border-line bg-input">
            {state.image && (
              <img
                src={state.image.previewUrl}
                alt="Reference"
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        </figure>

        <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
          <figcaption className="flex items-center gap-1.5 text-2xs text-ink-muted">
            {mode === 'trace' ? 'Traced, fitted to this font' : 'Proposed result'}
            {state.busy && <Loader2 size={10} className="animate-spin" />}
          </figcaption>
          <div className="flex h-44 items-center justify-center overflow-hidden rounded border border-line bg-input">
            <svg viewBox={viewBox} className="h-full w-full">
              <g transform="scale(1,-1)">
                {/* The current glyph stays visible underneath, so the
                    difference is legible rather than asserted. */}
                <path
                  d={currentPath}
                  className="fill-ink-faint"
                  fillRule="nonzero"
                  opacity={0.28}
                />
                {mode === 'trace'
                  ? tracedPath && (
                      <path
                        d={tracedPath}
                        className="fill-accent"
                        fillRule="nonzero"
                        opacity={0.85}
                      />
                    )
                  : (
                      <path
                        d={previewPath}
                        className="fill-accent"
                        fillRule="nonzero"
                        opacity={0.85}
                      />
                    )}
              </g>
              <line
                x1={-upm * 0.08}
                y1={0}
                x2={width + upm * 0.08}
                y2={0}
                className="stroke-line-strong"
                strokeWidth={upm * 0.004}
              />
            </svg>
          </div>
        </figure>
      </div>

      {mode === 'trace' && (
        <div className="rounded border border-line bg-input p-2">
          <p className="font-mono text-2xs text-ink-muted">
            {state.contourCount} contour{state.contourCount === 1 ? '' : 's'} ·{' '}
            {state.nodeCount} nodes · advance kept at {Math.round(state.advanceWidth)}
          </p>
          <ul className="mt-1 space-y-0.5">
            {state.notes.map((note, index) => (
              <li key={index} className="text-[10px] text-ink-faint">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.error && (
        <p className="flex items-start gap-1.5 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs text-ink">
          <AlertTriangle size={11} className="mt-px shrink-0 text-warn" />
          {state.error}
        </p>
      )}
    </div>
  )
}

function TraceControls({
  state,
  settings,
  setSettings,
}: {
  state: ReturnType<typeof useImageTrace>['state']
  settings: ReturnType<typeof useImageTrace>['settings']
  setSettings: ReturnType<typeof useImageTrace>['setSettings']
}) {
  const level = settings.level ?? state.detectedLevel
  const inkIsDark = settings.inkIsDark ?? state.detectedInkIsDark

  return (
    <div className="space-y-3">
      <Section title="Threshold">
        <input
          type="range"
          min={1}
          max={254}
          value={level}
          onChange={(event) =>
            setSettings({ ...settings, level: Number(event.target.value) })
          }
          className="w-full accent-[var(--fis-accent)]"
          aria-label="Threshold level"
        />
        <div className="flex items-center justify-between">
          <span className="font-mono text-2xs text-ink-faint">{level}</span>
          <button
            type="button"
            onClick={() => setSettings({ ...settings, level: null, inkIsDark: null })}
            className="text-2xs text-accent hover:underline"
          >
            Auto ({state.detectedLevel})
          </button>
        </div>
        <label className="mt-1 flex items-center gap-1.5 text-2xs text-ink-muted">
          <input
            type="checkbox"
            checked={!inkIsDark}
            onChange={(event) =>
              setSettings({ ...settings, inkIsDark: !event.target.checked })
            }
            className="accent-[var(--fis-accent)]"
          />
          Letter is lighter than its background
        </label>
      </Section>

      <Section title="Curve fitting">
        <label className="flex items-center gap-2 text-2xs text-ink-muted">
          Tolerance
          <NumberInput
            ariaLabel="Curve tolerance"
            value={settings.tolerance ?? state.detectedTolerance}
            min={0.15}
            max={4}
            step={0.1}
            precision={2}
            onChange={(tolerance) => setSettings({ ...settings, tolerance })}
            className="w-20"
          />
        </label>
        <p className="mt-1 text-[10px] text-ink-faint">
          Lower follows the image more exactly and adds nodes; higher gives a
          cleaner path that a designer can actually edit.
        </p>

        <label className="mt-2 flex items-center gap-2 text-2xs text-ink-muted">
          Smoothing
          <NumberInput
            ariaLabel="Pre-trace smoothing"
            value={settings.smoothing ?? state.detectedSmoothing}
            min={0}
            max={8}
            step={1}
            onChange={(smoothing) => setSettings({ ...settings, smoothing })}
            className="w-16"
          />
        </label>
        <p className="mt-1 text-[10px] text-ink-faint">
          Softens the edge before tracing. Needed for screenshots and 1-bit
          scans, where a hard pixel edge would otherwise trace as a staircase.
        </p>
      </Section>

      <Section title="Fit to">
        <Segmented
          className="w-full"
          value={settings.vertical}
          onChange={(vertical) => setSettings({ ...settings, vertical })}
          options={[
            { value: VERTICAL_FIT.GlyphBounds, label: 'Glyph' },
            { value: VERTICAL_FIT.XHeight, label: 'x-height' },
            { value: VERTICAL_FIT.CapHeight, label: 'Cap' },
          ]}
        />
        <div className="mt-1.5">
          <Segmented
            className="w-full"
            value={settings.horizontal}
            onChange={(horizontal) => setSettings({ ...settings, horizontal })}
            options={[
              { value: HORIZONTAL_FIT.KeepAspect, label: 'Keep shape' },
              { value: HORIZONTAL_FIT.MatchWidth, label: 'Match width' },
              { value: HORIZONTAL_FIT.Centre, label: 'Centre' },
            ]}
          />
        </div>
      </Section>
    </div>
  )
}

function StyleControls({
  axes,
  proposals,
  isAccepted,
  onToggle,
  limitations,
  glyphEmpty,
}: {
  axes: ReturnType<typeof compareProfiles>
  proposals: StyleProposal[]
  isAccepted: (proposal: StyleProposal) => boolean
  onToggle: (id: string, next: boolean) => void
  limitations: string[]
  glyphEmpty: boolean
}) {
  const acceptedCount = proposals.filter(isAccepted).length

  return (
    <div className="space-y-3">
      <Section title="Measured">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-ink-faint">
              <th className="text-left font-normal">Axis</th>
              <th className="text-right font-normal">This glyph</th>
              <th className="text-right font-normal">Reference</th>
            </tr>
          </thead>
          <tbody>
            {axes.map((axis) => (
              <tr key={axis.id} className="text-2xs">
                <td className="py-0.5 text-ink-muted">{axis.label}</td>
                <td className="py-0.5 text-right font-mono text-ink">
                  {formatAxisValue(axis.current, axis.format)}
                </td>
                <td
                  className={cn(
                    'py-0.5 text-right font-mono',
                    axis.matched ? 'text-ink-faint' : 'text-accent',
                  )}
                >
                  {formatAxisValue(axis.reference, axis.format)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Proposed (${acceptedCount} of ${proposals.length})`}>
        {glyphEmpty ? (
          <p className="text-2xs text-ink-faint">
            This glyph has no outline to adjust. Use Trace instead.
          </p>
        ) : proposals.length === 0 ? (
          <p className="text-2xs text-ink-faint">
            The two shapes already read the same on every axis this engine can
            move. Nothing to propose.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {proposals.map((proposal) => (
              <li
                key={proposal.id}
                className={cn(
                  'rounded border p-2',
                  isAccepted(proposal)
                    ? 'border-accent/40 bg-accent-soft/30'
                    : 'border-line bg-transparent opacity-50',
                )}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isAccepted(proposal)}
                    onChange={(event) =>
                      onToggle(proposal.id, event.target.checked)
                    }
                    className="mt-0.5 accent-[var(--fis-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-ink">
                        {proposal.label}
                      </span>
                      {proposal.confidence === 'estimated' && (
                        <span className="rounded-sm bg-warn/20 px-1 text-[9px] text-warn">
                          estimate
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-ink-muted">
                      {proposal.rationale}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {limitations.length > 0 && (
        <Section title="What this cannot do">
          <ul className="space-y-1">
            {limitations.map((note, index) => (
              <li key={index} className="flex gap-1.5 text-[10px] text-ink-faint">
                <Info size={10} className="mt-px shrink-0" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}
