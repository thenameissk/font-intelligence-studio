import { useMemo } from 'react'
import type { ParsedFont } from '@/engine/parser/parseFont'
import {
  displayFamilyName,
  displayStyleName,
} from '@/engine/parser/metadata'
import { CATEGORY_LABELS, CATEGORY_ORDER, type GlyphCategory } from '@/types/font'
import { formatBytes, formatUnits } from '@/utils/format'
import { WEIGHT_CLASS_NAMES, WIDTH_CLASS_NAMES } from '@/engine/analysis/classification'
import { FontDnaPanel } from './FontDnaPanel'
import { useFontDna } from './useFontDna'

export function FontOverview({ parsed }: { parsed: ParsedFont }) {
  const { metadata, verticalMetrics: vm } = parsed
  const dna = useFontDna()

  const coverage = useMemo(() => {
    const counts = new Map<GlyphCategory, number>()
    for (const entry of parsed.index) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
    }
    return CATEGORY_ORDER.map((category) => ({
      category,
      count: counts.get(category) ?? 0,
    })).filter((row) => row.count > 0)
  }, [parsed])

  const maxCoverage = Math.max(...coverage.map((c) => c.count), 1)

  return (
    <div className="h-full overflow-y-auto bg-base">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <header className="border-b border-line pb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {displayFamilyName(metadata)}
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {displayStyleName(metadata)}
            {metadata.names.version && (
              <span className="text-ink-faint"> · {metadata.names.version}</span>
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Chip>{metadata.outlineFormat === 'truetype' ? 'TrueType outlines' : `${metadata.outlineFormat.toUpperCase()} outlines`}</Chip>
            <Chip>{metadata.container.toUpperCase()}</Chip>
            <Chip>{metadata.numGlyphs.toLocaleString()} glyphs</Chip>
            <Chip>{formatBytes(metadata.fileSize)}</Chip>
            {metadata.isVariable && <Chip tone="accent">Variable</Chip>}
            {metadata.isItalic && <Chip>Italic</Chip>}
            {metadata.hasKerning && <Chip>Kerning</Chip>}
          </div>
        </header>

        {dna && (
          <section className="border-b border-line py-7">
            <FontDnaPanel dna={dna} />
          </section>
        )}

        <Grid>
          <Block title="Identification">
            <Field label="Family" value={metadata.names.fontFamily} />
            <Field label="Subfamily" value={metadata.names.fontSubfamily} />
            <Field label="PostScript name" value={metadata.names.postScriptName} mono />
            <Field label="Full name" value={metadata.names.fullName} />
            <Field label="Unique ID" value={metadata.names.uniqueID} mono />
          </Block>

          <Block title="Classification">
            <Field
              label="Weight class"
              value={
                metadata.weightClass === null
                  ? null
                  : `${metadata.weightClass} · ${WEIGHT_CLASS_NAMES[metadata.weightClass] ?? 'Custom'}`
              }
            />
            <Field
              label="Width class"
              value={
                metadata.widthClass === null
                  ? null
                  : `${metadata.widthClass} · ${WIDTH_CLASS_NAMES[metadata.widthClass] ?? 'Custom'}`
              }
            />
            <Field label="Italic" value={metadata.isItalic ? 'Yes' : 'No'} />
            <Field label="Italic angle" value={`${formatUnits(vm.italicAngle, 1)}°`} />
            <Field label="Embedding" value={metadata.embeddingPermission} />
          </Block>

          <Block title="Vertical metrics">
            <Field label="Units per em" value={String(vm.unitsPerEm)} mono />
            <Field label="Ascender" value={formatUnits(vm.ascender)} mono />
            <Field label="Descender" value={formatUnits(vm.descender)} mono />
            <Field label="Line gap" value={formatUnits(vm.lineGap)} mono />
            <Field
              label="Cap height"
              value={vm.capHeight === null ? null : formatUnits(vm.capHeight)}
              mono
            />
            <Field
              label="x-height"
              value={vm.xHeight === null ? null : formatUnits(vm.xHeight)}
              mono
            />
          </Block>

          <Block title="Legal">
            <Field label="Designer" value={metadata.names.designer} />
            <Field label="Manufacturer" value={metadata.names.manufacturer} />
            <Field label="Trademark" value={metadata.names.trademark} clamp />
            <Field label="Copyright" value={metadata.names.copyright} clamp />
            <Field label="License" value={metadata.names.license} clamp />
            <Field label="License URL" value={metadata.names.licenseURL} mono clamp />
          </Block>
        </Grid>

        <Section title="Unicode coverage">
          <p className="mb-3 text-xs text-ink-muted">
            {metadata.mappedCodepoints.toLocaleString()} code points mapped
            across {coverage.length} categories.
          </p>
          <div className="space-y-1">
            {coverage.map(({ category, count }) => (
              <div key={category} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-ink-muted">
                  {CATEGORY_LABELS[category]}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-input">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(count / maxCoverage) * 100}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-2xs tabular text-ink-faint">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {metadata.axes.length > 0 && (
          <Section title="Variable axes">
            <div className="space-y-2">
              {metadata.axes.map((axis) => (
                <div key={axis.tag} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-xs text-ink">
                    {axis.name}
                    <span className="ml-1 font-mono text-2xs text-ink-faint">
                      {axis.tag}
                    </span>
                  </span>
                  <span className="font-mono text-2xs tabular text-ink-muted">
                    {axis.minValue} → {axis.maxValue}
                  </span>
                  <span className="font-mono text-2xs tabular text-ink-faint">
                    default {axis.defaultValue}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title={`OpenType features (${metadata.features.length})`}>
          {metadata.features.length === 0 ? (
            <p className="text-xs text-ink-faint">
              No GSUB or GPOS features declared.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {metadata.features.map((feature) => (
                <div
                  key={`${feature.table}-${feature.tag}`}
                  className="flex items-baseline gap-2"
                >
                  <span className="w-9 shrink-0 font-mono text-2xs text-accent">
                    {feature.tag}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                    {feature.description}
                  </span>
                  <span className="font-mono text-2xs text-ink-faint">
                    {feature.table}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={`Tables (${metadata.tables.length})`}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-1">
            {metadata.tables.map((table) => (
              <div key={table.tag} className="flex items-baseline gap-2">
                <span className="w-10 shrink-0 font-mono text-2xs text-ink">
                  {table.tag.trim()}
                </span>
                <span className="font-mono text-2xs tabular text-ink-faint">
                  {formatBytes(table.length)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-7 py-7 md:grid-cols-2">
      {children}
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </h2>
      <dl className="space-y-1">{children}</dl>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-7">
      <h2 className="mb-3 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({
  label,
  value,
  mono = false,
  clamp = false,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  clamp?: boolean
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-xs text-ink-muted">{label}</dt>
      <dd
        data-selectable
        className={[
          'min-w-0 flex-1 text-xs',
          mono ? 'font-mono text-2xs' : '',
          clamp ? 'line-clamp-2' : 'truncate',
          value ? 'text-ink' : 'text-ink-faint',
        ].join(' ')}
      >
        {value || '—'}
      </dd>
    </div>
  )
}

function Chip({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent'
}) {
  return (
    <span
      className={[
        'rounded border px-1.5 py-0.5 text-2xs',
        tone === 'accent'
          ? 'border-transparent bg-accent-soft text-accent'
          : 'border-line bg-panel text-ink-muted',
      ].join(' ')}
    >
      {children}
    </span>
  )
}
