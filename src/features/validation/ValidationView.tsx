import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import type { Issue, IssueSeverity, ValidationReport } from '@/types/validation'
import { ISSUE_LABELS } from '@/types/validation'
import { Button } from '@/components/ui/Button'
import { useEditorStore } from '@/store/editorStore'
import { useUiStore, WORKSPACE } from '@/store/uiStore'
import { cn } from '@/utils/cn'
import { useValidation } from './useValidation'

const SEVERITY_ICON: Record<IssueSeverity, React.ReactNode> = {
  error: <ShieldAlert size={12} className="text-danger" />,
  warning: <AlertTriangle size={12} className="text-warn" />,
  info: <Info size={12} className="text-ink-faint" />,
}

export function ValidationView() {
  const { report, running, error, stale, revalidate } = useValidation()
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>(
    'all',
  )
  const [codeFilter, setCodeFilter] = useState<string | 'all'>('all')

  const filtered = useMemo(() => {
    if (!report) return []
    return report.issues.filter(
      (issue) =>
        (severityFilter === 'all' || issue.severity === severityFilter) &&
        (codeFilter === 'all' || issue.code === codeFilter),
    )
  }, [report, severityFilter, codeFilter])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <ShieldAlert size={22} className="mx-auto text-danger" />
          <p className="mt-2 text-xs text-ink">Font QA could not run</p>
          <p className="mt-1 text-2xs text-ink-muted">{error}</p>
          <Button className="mt-3" size="sm" onClick={revalidate}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Loader2 size={20} className="animate-spin text-accent" />
        <p className="text-xs text-ink-muted">Checking every glyph…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base">
      <ReportHeader
        report={report}
        running={running}
        stale={stale}
        onRefresh={revalidate}
      />

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-4 py-2">
        <FilterChip
          active={severityFilter === 'all' && codeFilter === 'all'}
          onClick={() => {
            setSeverityFilter('all')
            setCodeFilter('all')
          }}
        >
          All {report.issues.length}
        </FilterChip>
        {(['error', 'warning', 'info'] as const).map((severity) => {
          const count =
            severity === 'error'
              ? report.errorCount
              : severity === 'warning'
                ? report.warningCount
                : report.infoCount
          if (count === 0) return null
          return (
            <FilterChip
              key={severity}
              active={severityFilter === severity}
              onClick={() => {
                setSeverityFilter(severity)
                setCodeFilter('all')
              }}
            >
              {SEVERITY_ICON[severity]}
              {count}
            </FilterChip>
          )
        })}
        <span className="mx-1 w-px bg-line" />
        {Object.entries(report.counts)
          .sort((a, b) => b[1] - a[1])
          .map(([code, count]) => (
            <FilterChip
              key={code}
              active={codeFilter === code}
              onClick={() => {
                setCodeFilter(codeFilter === code ? 'all' : code)
                setSeverityFilter('all')
              }}
            >
              {ISSUE_LABELS[code as keyof typeof ISSUE_LABELS] ?? code} {count}
            </FilterChip>
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 size={22} className="text-ok" />
            <p className="text-xs text-ink">Nothing to report here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line/60">
            {filtered.slice(0, 500).map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        )}
        {filtered.length > 500 && (
          <p className="px-4 py-3 text-2xs text-ink-faint">
            Showing the first 500 of {filtered.length}. Filter to narrow this
            down.
          </p>
        )}
      </div>
    </div>
  )
}

function ReportHeader({
  report,
  running,
  stale,
  onRefresh,
}: {
  report: ValidationReport
  running: boolean
  stale: boolean
  onRefresh: () => void
}) {
  const tone =
    report.score >= 90 ? 'ok' : report.score >= 70 ? 'warn' : 'danger'

  return (
    <header className="shrink-0 border-b border-line px-4 py-4">
      <div className="flex items-start gap-5">
        <div>
          <p className="text-2xs font-semibold tracking-wide text-ink-muted uppercase">
            Font health
          </p>
          <p
            className={cn(
              'mt-1 font-mono text-3xl tabular leading-none',
              tone === 'ok'
                ? 'text-ok'
                : tone === 'warn'
                  ? 'text-warn'
                  : 'text-danger',
            )}
          >
            {report.score}
            <span className="text-base text-ink-faint"> / 100</span>
          </p>
        </div>

        <div className="mt-1 flex-1 space-y-0.5">
          <Line
            ok={report.errorCount === 0}
            text={
              report.errorCount === 0
                ? `${(report.glyphsChecked - report.glyphsWithIssues).toLocaleString()} of ${report.glyphsChecked.toLocaleString()} glyphs clean`
                : `${report.errorCount} blocking problem${report.errorCount === 1 ? '' : 's'}`
            }
          />
          <Line
            ok={report.metricsValid}
            text={report.metricsValid ? 'Metrics valid' : 'Metrics invalid'}
          />
          {report.warningCount > 0 && (
            <Line
              ok={false}
              warn
              text={`${report.warningCount} warning${report.warningCount === 1 ? '' : 's'}`}
            />
          )}
          {report.missingRecommended.length > 0 && (
            <Line
              ok={false}
              warn
              text={`${report.missingRecommended.length} recommended glyphs missing`}
            />
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <Button size="sm" onClick={onRefresh} disabled={running}>
            {running ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            {running ? 'Checking' : 'Recheck'}
          </Button>
          <span className="font-mono text-2xs text-ink-faint">
            {stale && !running ? 'edits pending' : `${report.durationMs} ms`}
          </span>
        </div>
      </div>

      {report.truncated && (
        <p className="mt-2 text-2xs text-warn">
          This font is very large; only the first{' '}
          {report.glyphsChecked.toLocaleString()} glyphs were checked.
        </p>
      )}
    </header>
  )
}

function Line({
  ok,
  warn = false,
  text,
}: {
  ok: boolean
  warn?: boolean
  text: string
}) {
  return (
    <p className="flex items-center gap-1.5 text-xs">
      <span className={ok ? 'text-ok' : warn ? 'text-warn' : 'text-danger'}>
        {ok ? '✓' : warn ? '⚠' : '✕'}
      </span>
      <span className="text-ink-muted">{text}</span>
    </p>
  )
}

function IssueRow({ issue }: { issue: Issue }) {
  const selectGlyph = useEditorStore((s) => s.selectGlyph)
  const setWorkspace = useUiStore((s) => s.setWorkspace)

  const goToGlyph = (): void => {
    if (issue.glyphIndex === null) return
    selectGlyph(issue.glyphIndex)
    setWorkspace(WORKSPACE.Glyphs)
  }

  return (
    <li>
      <button
        type="button"
        disabled={issue.glyphIndex === null}
        onClick={goToGlyph}
        className={cn(
          'flex w-full items-start gap-2.5 px-4 py-2 text-left',
          issue.glyphIndex !== null && 'hover:bg-hover',
        )}
      >
        <span className="mt-0.5 shrink-0">{SEVERITY_ICON[issue.severity]}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-ink">{issue.title}</span>
            {issue.glyphName && (
              <span className="font-mono text-2xs text-accent">
                {issue.glyphName}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-2xs text-ink-muted">
            {issue.detail}
          </span>
        </span>
        {issue.glyphIndex !== null && (
          <ChevronRight size={12} className="mt-1 shrink-0 text-ink-faint" />
        )}
      </button>
    </li>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-elevated text-ink-muted hover:bg-hover hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
