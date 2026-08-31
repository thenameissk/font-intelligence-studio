import { X } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { modKey } from '@/utils/format'

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Application',
    items: [
      [`${modKey()} K`, 'Command menu'],
      [`${modKey()} S`, 'Save project'],
      [`${modKey()} E`, 'Export font'],
      [`${modKey()} Z`, 'Undo'],
      [`⇧ ${modKey()} Z`, 'Redo'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'Tools',
    items: [
      ['V', 'Selection: whole contours'],
      ['A', 'Direct selection: anchors and handles'],
      ['P', 'Pen: draw a new contour'],
      ['C', 'Anchor point: corner / smooth'],
      ['K', 'Scissors: cut a path open'],
      ['R', 'Rotate about a placed origin'],
      ['S', 'Scale about a placed origin'],
      ['I', 'Measure'],
      ['H', 'Hand'],
      ['Z', 'Zoom'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Space + drag', 'Pan'],
      ['Scroll', 'Pan'],
      [`${modKey()} scroll`, 'Zoom at the pointer'],
      ['+ / −', 'Zoom in and out'],
      ['0', 'Fit glyph to view'],
      ['Double-click a curve', 'Insert a node'],
      ['Drag from a ruler', 'Add a guide'],
      ['Double-click a guide', 'Remove it'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['Click', 'Select a node'],
      ['Shift click', 'Add to the selection'],
      ['Drag on empty space', 'Marquee select'],
      ['Arrow keys', 'Nudge by one unit'],
      ['⇧ arrows', 'Nudge by ten'],
      ['⌥ arrows', 'Nudge by a half'],
      ['⇧ drag', 'Constrain to one axis'],
      ['⌥ drag a handle', 'Break the smooth join'],
      ['Delete', 'Delete selected nodes or contours'],
      [`${modKey()} A`, 'Select all'],
      [`${modKey()} C / V`, 'Copy and paste contours'],
      [`${modKey()} D`, 'Duplicate contours'],
      ['⌥ drag', 'Duplicate while dragging'],
      ['Enter', 'Finish the pen path'],
      ['Esc', 'Cancel the pen path or clear the selection'],
    ],
  },
]

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen)
  const setOpen = useUiStore((s) => s.setShortcutsOpen)
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 p-8 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-line bg-elevated shadow-xl"
      >
        <header className="flex h-10 items-center border-b border-line px-3">
          <h2 className="flex-1 text-xs font-semibold text-ink">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
          >
            <X size={13} />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-6 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
                {group.title}
              </h3>
              <dl className="space-y-1">
                {group.items.map(([keys, description]) => (
                  <div key={keys} className="flex items-baseline gap-2">
                    <dt className="shrink-0">
                      <kbd className="rounded border border-line bg-panel px-1 font-mono text-[10px] text-ink-muted">
                        {keys}
                      </kbd>
                    </dt>
                    <dd className="min-w-0 flex-1 text-2xs text-ink-muted">
                      {description}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
