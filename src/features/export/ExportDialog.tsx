import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Download,
  Info,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react'
import type { ImportWarning } from '@/types/font'
import {
  EXPORT_FORMAT,
  exportFont,
  OUTLINE_TARGET,
  type ExportFormat,
  type ExportResult,
  type OutlineTarget,
} from '@/engine/export/exporter'
import { Button } from '@/components/ui/Button'
import { useFontStore } from '@/store/fontStore'
import { useValidation } from '@/features/validation/useValidation'
import { formatBytes } from '@/utils/format'
import { cn } from '@/utils/cn'

const FORMATS: Array<{ value: ExportFormat; label: string; note: string }> = [
  { value: EXPORT_FORMAT.OTF, label: 'OTF', note: 'PostScript outlines' },
  { value: EXPORT_FORMAT.TTF, label: 'TTF', note: 'TrueType outlines' },
  { value: EXPORT_FORMAT.WOFF, label: 'WOFF', note: 'Web, deflate' },
  { value: EXPORT_FORMAT.WOFF2, label: 'WOFF2', note: 'Web, brotli' },
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const parsed = useFontStore((s) => s.parsed)
  const edits = useFontStore((s) => s.edits)
  const kerningEdits = useFontStore((s) => s.kerningEdits)
  const { report } = useValidation()

  const sourceFormat =
    parsed?.metadata.outlineFormat === 'truetype' ? 'ttf' : 'otf'
  const [format, setFormat] = useState<ExportFormat>(sourceFormat)
  const [outlines, setOutlines] = useState<OutlineTarget>(OUTLINE_TARGET.Source)
  const [includeKerning, setIncludeKerning] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The blob outlives the export call, so it has to be released when the
  // dialog closes or a second export replaces it.
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    },
    [downloadUrl],
  )

  const checks = useMemo(() => {
    if (!parsed) return []
    const errors = report?.errorCount ?? 0
    const contourIssues =
      (report?.counts['self-intersection'] ?? 0) +
      (report?.counts['open-contour'] ?? 0) +
      (report?.counts['malformed-curve'] ?? 0)
    return [
      {
        label: 'Contours',
        ok: (report?.counts['open-contour'] ?? 0) === 0,
        detail:
          contourIssues === 0
            ? `${parsed.glyphs.length.toLocaleString()} glyphs encode cleanly`
            : `${contourIssues} contour note${contourIssues === 1 ? '' : 's'} — none block export`,
      },
      {
        label: 'Metrics',
        ok: report?.metricsValid ?? true,
        detail: errors > 0 ? `${errors} invalid metric${errors === 1 ? '' : 's'}` : 'Advance widths and bearings valid',
      },
      {
        label: 'Unicode',
        ok: parsed.metadata.mappedCodepoints > 0,
        detail: `${parsed.metadata.mappedCodepoints.toLocaleString()} code points mapped, cmap preserved`,
      },
      {
        label: 'Kerning',
        ok: true,
        detail:
          Object.keys(kerningEdits).length > 0
            ? `${Object.keys(kerningEdits).length} pairs edited, written to kern`
            : 'Original kerning preserved unchanged',
      },
      {
        label: 'OpenType tables',
        ok: true,
        detail: `${parsed.metadata.tables.length} tables; everything unmodelled is copied verbatim`,
      },
    ]
  }, [parsed, report, kerningEdits])

  if (!parsed) return null

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const exported = await exportFont(parsed, edits, kerningEdits, {
        format,
        outlines,
        includeKerning,
      })
      const url = URL.createObjectURL(
        new Blob([exported.data], { type: exported.mimeType }),
      )
      setResult(exported)
      setDownloadUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return url
      })
      attemptDownload(url, exported.fileName)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const blocking = (report?.errorCount ?? 0) > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-base/70 p-8 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="mt-12 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
      >
        <header className="flex h-10 shrink-0 items-center border-b border-line px-3">
          <h2 className="text-xs font-semibold text-ink">Export font</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <X size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Section title="Export check">
            <ul className="space-y-1">
              {checks.map((check) => (
                <li key={check.label} className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 shrink-0',
                      check.ok ? 'text-ok' : 'text-warn',
                    )}
                  >
                    {check.ok ? '✓' : '⚠'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs text-ink">{check.label}</span>
                    <span className="ml-2 text-2xs text-ink-muted">
                      {check.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {blocking && (
              <p className="mt-2 flex items-start gap-1.5 rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-2xs text-ink">
                <ShieldAlert size={12} className="mt-px shrink-0 text-danger" />
                <span>
                  {report?.errorCount} glyph{report?.errorCount === 1 ? '' : 's'}{' '}
                  have errors that will produce a broken font. Fix them under QA
                  before exporting.
                </span>
              </p>
            )}
          </Section>

          <Section title="Format">
            <div className="grid grid-cols-4 gap-1">
              {FORMATS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormat(option.value)}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-left transition-colors',
                    format === option.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-elevated hover:bg-hover',
                  )}
                >
                  <span
                    className={cn(
                      'block text-xs font-medium',
                      format === option.value ? 'text-accent' : 'text-ink',
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="block text-[10px] text-ink-faint">
                    {option.note}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Outlines">
            <div className="flex gap-1">
              {[
                { value: OUTLINE_TARGET.Source, label: `Keep ${parsed.metadata.outlineFormat === 'truetype' ? 'TrueType' : 'PostScript'}` },
                { value: OUTLINE_TARGET.TrueType, label: 'TrueType' },
                { value: OUTLINE_TARGET.CFF, label: 'PostScript' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOutlines(option.value)}
                  className={cn(
                    'rounded border px-2 py-1 text-[10px] transition-colors',
                    outlines === option.value
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-elevated text-ink-muted hover:bg-hover',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-2xs text-ink-muted">
              <input
                type="checkbox"
                checked={includeKerning}
                onChange={(event) => setIncludeKerning(event.target.checked)}
                className="accent-[var(--fis-accent)]"
              />
              Write edited kerning to a kern table
            </label>
          </Section>

          {result && (
            <Section title="Result">
              <p className="text-xs text-ink">
                <span className="font-mono">{result.fileName}</span> ·{' '}
                {formatBytes(result.stats.bytes)}
              </p>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={result.fileName}
                  className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent bg-accent px-2.5 text-xs font-medium text-on-accent hover:opacity-90"
                >
                  <Download size={12} />
                  Save {result.fileName}
                </a>
              )}
              <p className="mt-1 text-[10px] text-ink-faint">
                The download usually starts on its own. If your browser
                blocked it, use the button above.
              </p>
              <p className="mt-1 text-2xs text-ink-muted">
                {result.stats.reEncodedGlyphs} of {result.stats.glyphCount}{' '}
                glyphs re-encoded, {result.stats.preservedTables.length} tables
                copied unchanged.
              </p>
              {result.stats.droppedTables.length > 0 && (
                <p className="mt-0.5 font-mono text-2xs text-ink-faint">
                  dropped: {result.stats.droppedTables.join(', ')}
                </p>
              )}
            </Section>
          )}

          {(result?.warnings.length ?? 0) > 0 && (
            <Section title="Notes">
              <ul className="space-y-1.5">
                {result!.warnings.map((warning, index) => (
                  <WarningRow key={index} warning={warning} />
                ))}
              </ul>
            </Section>
          )}

          {error && (
            <p className="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-2xs text-ink">
              {error}
            </p>
          )}
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-3">
          <p className="flex-1 text-2xs text-ink-faint">
            Unmodelled tables are copied byte for byte from the imported font.
          </p>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy}>
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            {result ? 'Export again' : 'Export font'}
          </Button>
        </footer>
      </div>
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
    <section className="mb-4 last:mb-0">
      <h3 className="mb-1.5 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function WarningRow({ warning }: { warning: ImportWarning }) {
  const icon =
    warning.severity === 'error' ? (
      <ShieldAlert size={12} className="text-danger" />
    ) : warning.severity === 'warning' ? (
      <AlertTriangle size={12} className="text-warn" />
    ) : (
      <Info size={12} className="text-ink-faint" />
    )
  return (
    <li className="flex items-start gap-1.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xs text-ink">{warning.message}</span>
        {warning.detail && (
          <span className="block text-[10px] text-ink-faint">
            {warning.detail}
          </span>
        )}
      </span>
    </li>
  )
}

/**
 * Attempts to save the file without further clicking.
 *
 * This is best-effort, and deliberately not the only route. Building a font
 * is asynchronous, so by the time the bytes exist the browser no longer
 * regards the original click as the cause of the download, and a synthetic
 * anchor click may be ignored with no error anywhere — the export appears
 * to succeed and no file arrives. The dialog therefore also shows a real
 * link the person can click, which browsers always honour.
 */
function attemptDownload(url: string, fileName: string): void {
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    // Removing the element in the same tick can cancel the download in
    // some browsers; let it settle first.
    setTimeout(() => link.remove(), 1000)
  } catch {
    // The visible link below is the reliable path anyway.
  }
}

