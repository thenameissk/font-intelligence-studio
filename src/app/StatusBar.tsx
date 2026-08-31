import { AlertTriangle, History, Info, Keyboard, ShieldAlert } from 'lucide-react'
import { resolveGlyph } from '@/engine/parser/glyphAccess'
import { formatCodepoint } from '@/engine/parser/unicode'
import { countNodes } from '@/engine/geometry/outline'
import { useEditorStore } from '@/store/editorStore'
import { useFontStore } from '@/store/fontStore'
import { useHistoryStore } from '@/store/historyStore'
import { useUiStore } from '@/store/uiStore'
import { formatBytes } from '@/utils/format'

export function StatusBar() {
  const parsed = useFontStore((s) => s.parsed)
  const warnings = useFontStore((s) => s.warnings)
  const historyCount = useHistoryStore((s) => s.past.length)
  const toggleHistory = useUiStore((s) => s.toggleHistory)
  const historyOpen = useUiStore((s) => s.historyOpen)
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen)
  const edits = useFontStore((s) => s.edits)
  const selected = useEditorStore((s) => s.selectedGlyphs)
  const selectedNodes = useEditorStore((s) => s.selectedNodes)

  const primaryIndex = selected.length > 0 ? selected[selected.length - 1] : null
  const glyph =
    parsed && primaryIndex !== null
      ? resolveGlyph(parsed, edits, primaryIndex)
      : null

  const errors = warnings.filter((w) => w.severity === 'error').length
  const cautions = warnings.filter((w) => w.severity === 'warning').length
  const notes = warnings.filter((w) => w.severity === 'info').length

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-2.5 font-mono text-2xs text-ink-muted">
      {parsed ? (
        <>
          {glyph ? (
            <>
              <span className="text-accent">{glyph.name}</span>
              <Cell label="" value={formatCodepoint(glyph.unicode)} />
              <Cell label="adv" value={String(Math.round(glyph.advanceWidth))} />
              <Cell
                label="lsb"
                value={String(Math.round(glyph.leftSideBearing))}
              />
              <Cell
                label="rsb"
                value={String(Math.round(glyph.rightSideBearing))}
              />
              <Cell
                label="bbox"
                value={`${Math.round(glyph.bounds.xMin)},${Math.round(glyph.bounds.yMin)} ${Math.round(glyph.bounds.xMax)},${Math.round(glyph.bounds.yMax)}`}
              />
              <Cell label="nodes" value={String(countNodes(glyph.outline))} />
              {selectedNodes.length > 0 && (
                <span className="text-accent">
                  {selectedNodes.length} selected
                </span>
              )}
            </>
          ) : (
            <>
              <Cell
                label="glyphs"
                value={parsed.metadata.numGlyphs.toLocaleString()}
              />
              <Cell label="upm" value={String(parsed.verticalMetrics.unitsPerEm)} />
              <Cell
                label="outlines"
                value={
                  parsed.metadata.outlineFormat === 'truetype'
                    ? 'TrueType'
                    : parsed.metadata.outlineFormat.toUpperCase()
                }
              />
              <Cell label="cmap" value={`${parsed.metadata.mappedCodepoints} cp`} />
              <Cell label="tables" value={String(parsed.metadata.tables.length)} />
              <Cell label="size" value={formatBytes(parsed.metadata.fileSize)} />
            </>
          )}
          {parsed.metadata.isVariable && (
            <span className="rounded-sm bg-accent-soft px-1 text-accent">
              variable · {parsed.metadata.axes.map((a) => a.tag).join(' ')}
            </span>
          )}
          <div className="flex-1" />
          {errors > 0 && (
            <Badge icon={<ShieldAlert size={11} />} tone="danger" count={errors} />
          )}
          {cautions > 0 && (
            <Badge icon={<AlertTriangle size={11} />} tone="warn" count={cautions} />
          )}
          {notes > 0 && <Badge icon={<Info size={11} />} tone="muted" count={notes} />}
          <button
            type="button"
            onClick={toggleHistory}
            title="Operation history"
            className={`flex items-center gap-1 rounded px-1 hover:bg-hover ${
              historyOpen ? 'text-accent' : 'text-ink-faint'
            }`}
          >
            <History size={11} />
            <span className="tabular">{historyCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts (?)"
            className="rounded px-1 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <Keyboard size={11} />
          </button>
        </>
      ) : (
        <span className="text-ink-faint">Ready — open a font to start</span>
      )}
    </footer>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      {label && <span className="text-ink-faint">{label}</span>}
      <span className="tabular text-ink">{value}</span>
    </span>
  )
}

function Badge({
  icon,
  tone,
  count,
}: {
  icon: React.ReactNode
  tone: 'danger' | 'warn' | 'muted'
  count: number
}) {
  const color =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warn'
        ? 'text-warn'
        : 'text-ink-faint'
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      {icon}
      <span className="tabular">{count}</span>
    </span>
  )
}
