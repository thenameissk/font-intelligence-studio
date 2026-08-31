# Font Intelligence Studio

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/thenameissk/font-intelligence-studio)

A browser-based font analysis and glyph editing tool. Import a font, find out
what it is made of, change the actual vector geometry, and export a working
font file. Everything runs locally — no backend, no upload, no API key.

```bash
npm install
npm run dev
```

## What it does

**Import** — TTF, OTF, WOFF, WOFF2 and TrueType Collections. WOFF is
unwrapped in the browser; WOFF2 is Brotli-decompressed via WebAssembly, loaded
only when a WOFF2 is actually opened. The imported bytes are never modified.

**Analyze** — a Font DNA profile measured from the outlines themselves:
x-height, cap height, overshoot, stem width, stroke contrast, stress axis,
slant, serif style, corner and curvature character, plus estimated weight and
width. Every value is labelled with how it was obtained — measured from
geometry, declared in a font table, or estimated by a heuristic — because
half of them are heuristics and presenting them as facts would be misleading.

**Browse** — a virtualised glyph grid over the whole font, with categories,
search by character, name, code point or category, and a list of recommended
glyphs the font is missing.

**Edit** — a vector editor over the font's own outlines, with the toolset you
would expect from a drawing application:

| | |
|---|---|
| **V** Selection | whole contours, with a transform box |
| **A** Direct selection | anchors and Bézier handles |
| **P** Pen | draw a contour; click for a corner, drag for a curve, click the start to close |
| **C** Anchor point | switch corner and smooth, or drag handles out |
| **K** Scissors | cut a contour open where you click |
| **R** / **S** | rotate and scale about an origin you place |
| **I** Measure | distance and angle |
| **H** / **Z** | hand and marquee zoom |

The transform box scales from any of eight handles, rotates from just outside
the corners, and constrains with shift. Alt-drag duplicates. Copy, paste,
duplicate and select-all work on contours. Arrow keys nudge by a unit, ten
with shift, a half with alt. Snapping covers metrics, guides, the grid and
other anchors, with a live indicator for what it caught.

Path operations cover the rest: **remove overlap** (a real Bézier union, not
a flattened polygon), **simplify** (fits fewer curves through the same shape,
which matters after offsetting), align and average anchors, join endpoints,
cut, reverse direction, reorder, duplicate and delete contours.

Glyph metrics are editable numerically, with side bearings derived from
geometry the way a type editor expects.

**Transform** — scale, slant, rotate, flip, move, align and distribute; stroke
weight via real contour offsetting; corner rounding with true circular
fillets; and side-bearing normalisation. Every transformation previews live
and commits as a single undoable step.

**Suggest variants** — select a letter and the studio reads its
construction from the outline: how many counters it encloses, whether it is
built in one storey or two, where its narrowest join falls, whether it
carries a tail. It then offers the other forms of that letter *that this font
can actually supply* — a stylistic alternate the face already ships (SF's
`cv07` is its one-storey `a`), or a structural twin drawn by the same
designer (U+0251 is the one-storey `a`, U+0261 the single-storey `g`).

Each suggestion comes with an annotated comparison: the two forms on shared
baseline and x-height rules, with the places they differ ringed and named —
the join, the tail, the shoulder — and a plain-language list of what changes
("Two-storey → One-storey", "1 more enclosed counter", "+106 units"). One
click swaps the outline in as an undoable edit.

**Other typefaces** — add faces to a reference library and the studio shows
how each of them draws the letter you are editing, grouped by construction:
a wall of `a`s separated into two-storey and one-storey, each labelled with
what it is (*Two-storey · Serif*, *One-storey · Sans serif · Medium*). Open a
specimen to compare it against your glyph, and borrow the drawing if you want
it — refitted to your font's x-height or cap height, on your font's left
bearing, with your advance width kept and contour directions set for your
outline format.

The library lives in your browser, holds up to sixty faces, and is populated
by dropping font files or — where the browser supports it — picking from the
fonts installed on the machine, one representative face per family. Borrowing
a drawing from another typeface is subject to that font's licence, which the
studio says at the point of use rather than burying.

Nothing is synthesised. Redrawing a two-storey `a` as a one-storey `a` is a
design decision, not a transformation, so when nothing in the font or the
library offers one, the panel says so instead of inventing a shape that
belongs to no typeface.

**Work from a reference image** — drop in a photograph, scan or screenshot
of a letter. It is decoded, thresholded (Otsu, so it needs no tuning),
smoothed, traced by marching squares with sub-pixel interpolation, and fitted
to Bézier curves. Tracing happens locally; the image is never uploaded.

Two separate things can then be done with it, kept apart because they mean
different things:

- **Trace** places the image's letterform into the glyph, scaled to the
  font's own x-height, cap height or the height of the glyph it replaces,
  positioned on the font's left bearing, with contour directions set for the
  font's outline format. The advance width is taken from the font, never from
  the image.
- **Match style** keeps this font's letter and moves it towards the
  reference. Both shapes are measured on the same axes — stem weight,
  horizontal stroke, contrast, width, slant, ink density, corner character —
  and the gap becomes concrete operations with the arithmetic shown: *"Stems
  measure 441 units against the reference's 344. Offsetting each edge by
  −44.4 units closes that."* Each is previewed, individually rejectable, and
  commits as one undoable step. Spacing is never touched: width changes scale
  the drawing inside the existing advance.

Anything the engine derives from a proxy rather than a measurement is marked
as an estimate and starts unchecked, and readings it cannot trust — a corner
comparison between shapes with too few corners to judge — are skipped with a
note saying why.

**Check** — a QA pass over every glyph: self-intersections, open contours,
duplicate nodes, tiny contours, malformed curves, suspicious contour
directions, spacing anomalies, inconsistent stems and figure widths, extreme
overshoot, invalid metrics and missing coverage. It runs in a Web Worker, and
every issue links to the glyph it came from.

**Preview** — a typography playground that lays out real text from the edited
outlines, with presets, full typographic controls and a draggable
original-versus-modified split.

**Kern** — a pair editor that reads whatever kerning the font already has,
whether from a `kern` table or GPOS, and lets you adjust pairs visually or
numerically.

**Export** — OTF, TTF, WOFF and WOFF2, with a pre-flight check.

**Projects** — saved with autosave and version history, either in this
browser or on a server.

**Run it behind Django** — `server/` is a Django project that serves the
studio and, for anyone who signs in, stores their projects and shares a font
library across the team. Signing in is optional: without it everything stays
in the browser and no font is uploaded, and the toolbar says which of the two
is in force. See [server/README.md](server/README.md).

## How export works

The exporter rebuilds only the tables your edits actually affect and copies
every other table out of the imported font byte for byte. That is what keeps
GPOS, GDEF, GSUB, colour tables, variable-font data and anything else this
application does not model intact, rather than silently dropping it the way a
full re-encode would.

For a TrueType font, only edited glyphs are re-encoded — untouched glyphs keep
their original bytes, so composites stay composite and hinting survives. For a
CFF font, the CFF table is rebuilt with Type 2 charstrings when any outline
changed. Cross-flavour conversion works in both directions and says plainly
what it drops.

Round-trip tests export each fixture, parse the result back and compare the
geometry, so "it exports" means "the exported font parses and matches", not
"the bytes were written".

## Running it

Standalone, as a static site:

```bash
npm ci
npm run dev
```

Behind Django, with accounts and shared storage:

```bash
npm run build:django
cd server && python3 manage.py migrate && python3 manage.py runserver
```

## Known limits

These are real, and the UI says so where it matters rather than failing
quietly:

- **Signing in to a server changes where your fonts live.** Standalone and
  signed out, everything stays in the browser. Signed in to the Django
  backend, the fonts you open and the typefaces you add to the shared
  library are uploaded — that is the point of it, but it is a different
  privacy position, so the toolbar always says which of the two is in force.

- **Kerning changes are written to a legacy `kern` table.** Rebuilding a GPOS
  pair lookup is out of scope, and shapers consult GPOS first — so on a font
  with a GPOS table your kerning edits will not take effect in most renderers.
  The kerning editor and the export dialog both warn about this.
- **Variable fonts are editable at the default instance only.** `fvar`, `gvar`
  and friends are preserved unchanged, which means an edited glyph will not
  vary correctly along the axes. Export warns.
- **CFF2 fonts are read-only.** Export is refused rather than attempted.
- **Text shaping is Latin-oriented.** The preview applies cmap, standard
  ligatures and kerning; complex scripts are not shaped.
- **TrueType hinting is dropped on edited glyphs.** Instructions written for
  the old outline would be wrong for the new one.
- **Contour offsetting adds nodes.** Offsetting a Bézier is an approximation,
  so the result is subdivided to stay within tolerance. Run Simplify
  afterwards to get an editable node count back.
- **Remove Overlap is union only.** Subtract, intersect and divide are not
  implemented; union is the operation fonts actually need.
- **Style matching moves attributes, not letterforms.** Weight, slant,
  proportion and corner character are measurable and a transformation can
  move them precisely. The identity of a letter is not: matching a
  reference's contrast or construction means redrawing curves, which the
  engine says rather than attempts.
- **Tracing quality follows the image.** A clean, high-contrast source traces
  to a couple of dozen editable nodes. Contour offsetting during a style
  match adds nodes; run Simplify afterwards to get an editable count back.
- **Variant suggestions come from the font, never from thin air.** If a face
  ships no alternate for a letter and has no structural twin, there is
  nothing to offer, and the panel says so. Construction is read reliably for
  `a` and `g`, where the two forms differ measurably; other letters get the
  anatomy read out but no construction label.

## Architecture

```
UI (React)  →  Stores (Zustand)  →  Engine  →  Parser / Exporter
```

The engine has no React in it and the UI has no font logic in it. Everything
under `src/engine/` is a pure function over plain data, which is why the
geometry, analysis, validation and export layers are all directly testable
without a browser.

```
src/
  app/          shell, routing between workspaces, shortcuts
  components/   UI primitives and the shared glyph renderer
  features/     one directory per workspace
  engine/
    parser/     container decoding, sfnt tables, font model, glyph access
    raster/     image decoding, thresholding, smoothing, contour tracing,
                vectorising and fitting a trace to the font's metrics
    geometry/   Bézier maths, the outline model, edits, intersection,
                curve-curve intersection, boolean union, simplification
    analysis/   measurement primitives, Font DNA, glyph structure,
                variant discovery and outline diffing
    library/    the reference library: storage, import, and pulling one
                letter out of another typeface with its classification
    transforms/ glyph transformations, offsetting, corner rounding, spacing,
                reference-style matching
    validation/ per-glyph and cross-glyph checks
    export/     glyf, CFF, table patching, WOFF
    typography/ text layout and kerning
    relationships/  glyph families
    ai/         the (unimplemented) assistant interface
  store/        document, editor, history, project, UI state
  workers/      the validation worker
```

Two decisions shape most of the rest:

**Edits are a sparse overlay, not a copy.** The imported font is immutable;
user changes live in a map keyed by glyph index. That makes "revert this
glyph" a deletion, keeps projects small, lets undo store only what a command
touched, and guarantees the original data is always available for export.

**Outlines use a node/handle model.** Every node is an on-curve anchor with
optional incoming and outgoing handles, the model Glyphs and FontLab use.
TrueType quadratics widen to cubics exactly on import; the approximation only
happens on the way back out to `glyf`.

## Testing

```bash
npm test
npm run typecheck
```

The suite runs against real fonts from the system where they exist, and skips
those tests where they do not. Geometry is checked against analytic results —
the area of an offset circle, the exact area a fillet removes from a corner,
de Casteljau splits verified to nine decimal places — rather than against
snapshots of its own output.

`src/engine/parser/robustness.test.ts` covers fonts that broke the parser
during development: TrueType Collections, and fonts whose `cmap` lists
subtables the parser cannot read before the one it can.

## AI

There is none, by design. `src/engine/ai/assistant.ts` defines the interface a
future assistant would implement: it can read the analysis and propose
operations as the same previewable, undoable specs the UI already uses, and it
cannot mutate the document. The application is complete without it.
