import { useEffect, useMemo, useState } from 'react'
import { Check, Repeat, RotateCcw, X } from 'lucide-react'
import type { ResolvedGlyph, VerticalMetrics } from '@/types/font'
import {
  applyTransformSpec,
  describeSpec,
  specIsIdentity,
  type TransformSpec,
} from '@/engine/transforms/applySpec'
import { ORIGIN_MODE, type OriginMode } from '@/engine/transforms/glyphTransforms'
import { findCorners } from '@/engine/transforms/roundCorners'
import { offsetIsRisky } from '@/engine/transforms/offset'
import { measureVerticalStem } from '@/engine/analysis/measure'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { PanelSection, Row } from '@/components/ui/Panel'
import { useHistoryStore } from '@/store/historyStore'
import { useTransformStore } from '@/store/transformStore'
import { ScopePicker } from './ScopePicker'
import { cn } from '@/utils/cn'

type Tab = 'transform' | 'shape' | 'spacing'

const PRESETS: Array<{ label: string; spec: TransformSpec }> = [
  {
    label: 'Width +5%',
    spec: { kind: 'scale', sx: 1.05, sy: 1, origin: 'baseline', scaleAdvance: true },
  },
  {
    label: 'Width −5%',
    spec: { kind: 'scale', sx: 0.95, sy: 1, origin: 'baseline', scaleAdvance: true },
  },
  {
    label: 'Height +5%',
    spec: { kind: 'scale', sx: 1, sy: 1.05, origin: 'baseline', scaleAdvance: false },
  },
  {
    label: 'Height −5%',
    spec: { kind: 'scale', sx: 1, sy: 0.95, origin: 'baseline', scaleAdvance: false },
  },
  { label: 'Slant 10°', spec: { kind: 'slant', degrees: 10 } },
  { label: 'Flip H', spec: { kind: 'flip', axis: 'horizontal' } },
]

/**
 * Transformation controls.
 *
 * Editing any control updates a live preview; nothing reaches the document
 * until Apply, and Apply records exactly one undoable command.
 */
export function TransformPanel({
  glyphs,
  label,
  metrics,
}: {
  glyphs: readonly ResolvedGlyph[]
  label: string
  /** Needed to offer bands like "below the baseline"; omit to hide scoping. */
  metrics?: VerticalMetrics
}) {
  const [tab, setTab] = useState<Tab>('transform')
  const [origin, setOrigin] = useState<OriginMode>(ORIGIN_MODE.CenterBaseline)
  const spec = useTransformStore((s) => s.spec)
  const setSpec = useTransformStore((s) => s.setSpec)
  const scope = useTransformStore((s) => s.scope)
  const setScope = useTransformStore((s) => s.setScope)
  const clear = useTransformStore((s) => s.clear)
  const lastApplied = useTransformStore((s) => s.lastApplied)
  const rememberApplied = useTransformStore((s) => s.rememberApplied)
  const commit = useHistoryStore((s) => s.commit)

  const targets = useMemo(() => glyphs.map((g) => g.index), [glyphs])
  const targetKey = targets.join(',')

  // A selection change invalidates any pending preview.
  useEffect(() => clear, [clear, targetKey])

  const update = (next: TransformSpec): void => setSpec(next, targets)

  const applySpec = (target: TransformSpec): void => {
    const changes = applyTransformSpec(glyphs, target, scope)
    if (Object.keys(changes).length > 0) {
      commit(describeSpec(target), changes)
      rememberApplied(target)
    }
    clear()
  }

  const apply = (): void => {
    if (!spec) return
    applySpec(spec)
  }

  if (glyphs.length === 0) return null

  return (
    <PanelSection title={`Transform ${label}`}>
      {/* Only meaningful on a single glyph: scoping by anchor across a
          multi-glyph selection would mean different things in each. */}
      {glyphs.length === 1 && metrics && (
        <ScopePicker
          glyph={glyphs[0]}
          metrics={metrics}
          scope={scope}
          onChange={setScope}
        />
      )}

      <div className="mb-2 flex gap-0.5 rounded-md bg-input p-0.5">
        {(['transform', 'shape', 'spacing'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'h-5 flex-1 rounded text-[10px] font-medium capitalize transition-colors',
              tab === value
                ? 'bg-elevated text-ink'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === 'transform' && (
        <TransformTab
          spec={spec}
          update={update}
          origin={origin}
          setOrigin={setOrigin}
        />
      )}
      {tab === 'shape' && (
        <ShapeTab spec={spec} update={update} glyphs={glyphs} />
      )}
      {tab === 'spacing' && <SpacingTab update={update} />}

      {!spec && lastApplied && (
        <button
          type="button"
          onClick={() => applySpec(lastApplied)}
          className="mt-2 flex w-full items-center gap-1.5 rounded border border-line px-2 py-1 text-left text-[10px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <Repeat size={11} className="shrink-0" />
          <span className="truncate">Repeat {describeSpec(lastApplied)}</span>
        </button>
      )}

      {spec && (
        <div className="mt-3 rounded-md border border-accent/40 bg-accent-soft/40 p-2">
          <p className="text-2xs text-ink">
            Previewing: <span className="font-medium">{describeSpec(spec)}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-ink-muted">
            {glyphs.length} glyph{glyphs.length === 1 ? '' : 's'} · not applied
            yet
          </p>
          <div className="mt-2 flex gap-1">
            <Button
              size="sm"
              variant="primary"
              disabled={specIsIdentity(spec)}
              onClick={apply}
            >
              <Check size={11} />
              Apply
            </Button>
            <Button size="sm" onClick={clear}>
              <X size={11} />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </PanelSection>
  )
}

/**
 * The reference-point widget every vector editor has: the point the
 * transformation holds still.
 *
 * Scaling a letter about the centre of its ink lifts it off the baseline,
 * which is almost never what a type designer wants, so the baseline row is
 * offered as its own choice rather than being approximated by the bottom of
 * the ink box -- those are different points on any letter with a descender.
 */
const ORIGIN_GRID: ReadonlyArray<readonly [OriginMode, string]> = [
  [ORIGIN_MODE.TopLeft, 'Top left'],
  [ORIGIN_MODE.TopCenter, 'Top centre'],
  [ORIGIN_MODE.TopRight, 'Top right'],
  [ORIGIN_MODE.MiddleLeft, 'Middle left'],
  [ORIGIN_MODE.Center, 'Centre of the ink'],
  [ORIGIN_MODE.MiddleRight, 'Middle right'],
  [ORIGIN_MODE.BottomLeft, 'Bottom left'],
  [ORIGIN_MODE.BottomCenter, 'Bottom centre'],
  [ORIGIN_MODE.BottomRight, 'Bottom right'],
]

function OriginPicker({
  origin,
  onChange,
}: {
  origin: OriginMode
  onChange: (origin: OriginMode) => void
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="grid grid-cols-3 gap-px rounded border border-line bg-line p-px">
        {ORIGIN_GRID.map(([value, label]) => (
          <button
            key={value}
            type="button"
            title={`Transform about the ${label.toLowerCase()}`}
            aria-label={label}
            aria-pressed={origin === value}
            onClick={() => onChange(value)}
            className={cn(
              'flex h-3.5 w-3.5 items-center justify-center bg-input transition-colors hover:bg-hover',
              origin === value && 'bg-accent',
            )}
          >
            <span
              className={cn(
                'h-1 w-1 rounded-full',
                origin === value ? 'bg-on-accent' : 'bg-ink-faint',
              )}
            />
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex gap-1">
          {(
            [
              [ORIGIN_MODE.CenterBaseline, 'Baseline'],
              [ORIGIN_MODE.Baseline, 'Origin'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              title={
                value === ORIGIN_MODE.Baseline
                  ? 'x = 0 on the baseline: the font origin'
                  : 'Centred horizontally, on the baseline vertically'
              }
              onClick={() => onChange(value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                origin === value
                  ? 'bg-elevated text-ink'
                  : 'text-ink-faint hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-ink-faint">
          Holds the {describeOrigin(origin)} still
        </p>
      </div>
    </div>
  )
}

function describeOrigin(origin: OriginMode): string {
  if (origin === ORIGIN_MODE.Baseline) return 'font origin'
  if (origin === ORIGIN_MODE.CenterBaseline) return 'baseline centre'
  return (
    ORIGIN_GRID.find(([value]) => value === origin)?.[1].toLowerCase() ??
    'origin'
  )
}

function TransformTab({
  spec,
  update,
  origin,
  setOrigin,
}: {
  spec: TransformSpec | null
  update: (spec: TransformSpec) => void
  origin: OriginMode
  setOrigin: (origin: OriginMode) => void
}) {
  const scale = spec?.kind === 'scale' ? spec : null
  const slant = spec?.kind === 'slant' ? spec : null
  const move = spec?.kind === 'move' ? spec : null
  const rotate = spec?.kind === 'rotate' ? spec : null

  // Changing the reference point re-previews the pending transformation
  // about the new point rather than silently applying to the next one.
  const changeOrigin = (next: OriginMode): void => {
    setOrigin(next)
    if (spec?.kind === 'scale') update({ ...spec, origin: next })
    if (spec?.kind === 'rotate') update({ ...spec, origin: next })
  }

  return (
    <div className="space-y-1">
      <div className="mb-2 flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            size="sm"
            onClick={() => update(preset.spec)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <OriginPicker origin={origin} onChange={changeOrigin} />

      <Row label="Width">
        <NumberInput
          ariaLabel="Scale width percent"
          value={Math.round((scale?.sx ?? 1) * 1000) / 10}
          precision={1}
          step={0.5}
          suffix="%"
          onChange={(value) =>
            update({
              kind: 'scale',
              sx: value / 100,
              sy: scale?.sy ?? 1,
              origin,
              scaleAdvance: true,
            })
          }
        />
      </Row>
      <Row label="Height">
        <NumberInput
          ariaLabel="Scale height percent"
          value={Math.round((scale?.sy ?? 1) * 1000) / 10}
          precision={1}
          step={0.5}
          suffix="%"
          onChange={(value) =>
            update({
              kind: 'scale',
              sx: scale?.sx ?? 1,
              sy: value / 100,
              origin,
              scaleAdvance: true,
            })
          }
        />
      </Row>
      <Row label="Rotate">
        <NumberInput
          ariaLabel="Rotate degrees"
          value={rotate?.degrees ?? 0}
          precision={1}
          step={0.5}
          suffix="°"
          onChange={(value) => update({ kind: 'rotate', degrees: value, origin })}
        />
      </Row>
      <Row label="Slant">
        <NumberInput
          ariaLabel="Slant degrees"
          value={slant?.degrees ?? 0}
          precision={1}
          step={0.5}
          suffix="°"
          onChange={(value) => update({ kind: 'slant', degrees: value })}
        />
      </Row>
      <Row label="Move X">
        <NumberInput
          ariaLabel="Move x"
          value={move?.dx ?? 0}
          suffix="u"
          onChange={(value) =>
            update({ kind: 'move', dx: value, dy: move?.dy ?? 0 })
          }
        />
      </Row>
      <Row label="Move Y">
        <NumberInput
          ariaLabel="Move y"
          value={move?.dy ?? 0}
          suffix="u"
          onChange={(value) =>
            update({ kind: 'move', dx: move?.dx ?? 0, dy: value })
          }
        />
      </Row>
    </div>
  )
}

function ShapeTab({
  spec,
  update,
  glyphs,
}: {
  spec: TransformSpec | null
  update: (spec: TransformSpec) => void
  glyphs: readonly ResolvedGlyph[]
}) {
  const offset = spec?.kind === 'offset' ? spec : null
  const round = spec?.kind === 'roundCorners' ? spec : null

  const narrowestStroke = useMemo(() => {
    const widths = glyphs
      .filter((g) => !g.isEmpty)
      .map((g) => measureVerticalStem(g.outline))
      .filter((w): w is number => w !== null)
    return widths.length > 0 ? Math.min(...widths) : null
  }, [glyphs])

  const cornerCount = useMemo(
    () =>
      glyphs.reduce(
        (sum, glyph) =>
          sum + findCorners(glyph.outline, round?.minAngle ?? 25).length,
        0,
      ),
    [glyphs, round?.minAngle],
  )

  const risky =
    offset !== null && offsetIsRisky(offset.distance, narrowestStroke)

  return (
    <div className="space-y-1">
      <Row label="Stroke weight" title="Expands or contracts every contour">
        <NumberInput
          ariaLabel="Stroke offset"
          value={offset?.distance ?? 0}
          step={1}
          suffix="u"
          onChange={(value) => update({ kind: 'offset', distance: value })}
        />
      </Row>
      {narrowestStroke !== null && (
        <p className="text-[10px] text-ink-faint">
          Narrowest measured stem: {Math.round(narrowestStroke)} units
        </p>
      )}
      {risky && (
        <p className="text-[10px] text-warn">
          Thinning this far will collapse the narrowest strokes. Preview before
          applying.
        </p>
      )}

      <Row label="Corner radius">
        <NumberInput
          ariaLabel="Corner radius"
          value={round?.radius ?? 0}
          min={0}
          step={1}
          suffix="u"
          onChange={(value) =>
            update({
              kind: 'roundCorners',
              radius: value,
              minAngle: round?.minAngle ?? 25,
            })
          }
        />
      </Row>
      <Row label="Min corner angle">
        <NumberInput
          ariaLabel="Minimum corner angle"
          value={round?.minAngle ?? 25}
          min={1}
          max={179}
          suffix="°"
          onChange={(value) =>
            update({
              kind: 'roundCorners',
              radius: round?.radius ?? 0,
              minAngle: value,
            })
          }
        />
      </Row>
      <p className="text-[10px] text-ink-faint">
        {cornerCount} corner{cornerCount === 1 ? '' : 's'} would be affected.
      </p>

      <div className="flex gap-1 pt-1">
        <Button
          size="sm"
          onClick={() => update({ kind: 'flip', axis: 'horizontal' })}
        >
          Flip H
        </Button>
        <Button
          size="sm"
          onClick={() => update({ kind: 'flip', axis: 'vertical' })}
        >
          Flip V
        </Button>
      </div>
    </div>
  )
}

function SpacingTab({ update }: { update: (spec: TransformSpec) => void }) {
  const [left, setLeft] = useState(40)
  const [right, setRight] = useState(40)
  const [factor, setFactor] = useState(100)

  return (
    <div className="space-y-1">
      <Row label="Left bearing">
        <NumberInput
          ariaLabel="Target left bearing"
          value={left}
          onChange={setLeft}
          suffix="u"
        />
      </Row>
      <Row label="Right bearing">
        <NumberInput
          ariaLabel="Target right bearing"
          value={right}
          onChange={setRight}
          suffix="u"
        />
      </Row>
      <div className="flex flex-wrap gap-1 pt-1">
        <Button
          size="sm"
          onClick={() =>
            update({ kind: 'spacing', rule: { mode: 'fixed', left, right } })
          }
        >
          Set to fixed
        </Button>
        <Button
          size="sm"
          onClick={() =>
            update({
              kind: 'spacing',
              rule: { mode: 'minimum', left, right },
            })
          }
        >
          Enforce minimum
        </Button>
      </div>

      <Row label="Scale bearings">
        <NumberInput
          ariaLabel="Scale bearings percent"
          value={factor}
          onChange={setFactor}
          suffix="%"
        />
      </Row>
      <div className="flex flex-wrap gap-1 pt-1">
        <Button
          size="sm"
          onClick={() =>
            update({
              kind: 'spacing',
              rule: { mode: 'scale', factor: factor / 100 },
            })
          }
        >
          Scale
        </Button>
        <Button
          size="sm"
          onClick={() =>
            update({
              kind: 'spacing',
              rule: { mode: 'average', strength: 1 },
            })
          }
        >
          <RotateCcw size={11} />
          Normalise to average
        </Button>
      </div>
    </div>
  )
}
