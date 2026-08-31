/**
 * Per-glyph structural checks.
 *
 * Each check looks at one glyph's geometry in isolation and reports concrete
 * defects with a location, so the UI can take the user straight to the
 * problem.
 */
import type { Issue, IssueCode } from '@/types/validation'
import { ISSUE_CODE } from '@/types/validation'
import type { ResolvedGlyph } from '@/types/font'
import type { Contour, Outline } from '@/types/geometry'
import {
  contourSegments,
  contourSignedArea,
  nodePoint,
} from '@/engine/geometry/outline'
import { contourNestingDepths } from '@/engine/geometry/nesting'
import { findSelfIntersections } from '@/engine/geometry/selfIntersect'
import { distance } from '@/engine/geometry/bezier'
import { isCombiningMark } from '@/engine/parser/unicode'

export interface GlyphCheckContext {
  unitsPerEm: number
  /** 'truetype' outers run clockwise; 'cff' outers run counter-clockwise. */
  outlineFormat: 'truetype' | 'cff' | 'cff2'
}

let issueCounter = 0
function issue(
  code: IssueCode,
  severity: Issue['severity'],
  glyph: ResolvedGlyph | null,
  title: string,
  detail: string,
  extra: Partial<Issue> = {},
): Issue {
  issueCounter += 1
  return {
    id: `iss${issueCounter}`,
    code,
    severity,
    title,
    detail,
    glyphIndex: glyph?.index ?? null,
    glyphName: glyph?.name ?? null,
    ...extra,
  }
}

export function resetIssueIds(): void {
  issueCounter = 0
}

/** Coincident consecutive on-curve points, which serve no purpose. */
function checkDuplicateNodes(
  glyph: ResolvedGlyph,
  context: GlyphCheckContext,
): Issue[] {
  const threshold = context.unitsPerEm * 0.0005
  const issues: Issue[] = []
  glyph.outline.contours.forEach((contour, contourIndex) => {
    const nodes = contour.nodes
    for (let i = 0; i < nodes.length; i += 1) {
      const next = nodes[(i + 1) % nodes.length]
      if (!contour.closed && i === nodes.length - 1) break
      if (distance(nodePoint(nodes[i]), nodePoint(next)) <= threshold) {
        issues.push(
          issue(
            ISSUE_CODE.DuplicateNode,
            'warning',
            glyph,
            'Duplicate node',
            `Two on-curve points in contour ${contourIndex + 1} sit on top of each other.`,
            {
              contourIndex,
              nodeId: nodes[i].id,
              point: nodePoint(nodes[i]),
            },
          ),
        )
      }
    }
  })
  return issues
}

function checkOpenContours(glyph: ResolvedGlyph): Issue[] {
  const issues: Issue[] = []
  glyph.outline.contours.forEach((contour, contourIndex) => {
    if (contour.closed) return
    issues.push(
      issue(
        ISSUE_CODE.OpenContour,
        'error',
        glyph,
        'Open contour',
        `Contour ${contourIndex + 1} is not closed. Open contours do not fill predictably and will not export correctly.`,
        { contourIndex, point: nodePoint(contour.nodes[0]) },
      ),
    )
  })
  return issues
}

function checkTinyContours(
  glyph: ResolvedGlyph,
  context: GlyphCheckContext,
): Issue[] {
  // Below about a thousandth of the em squared, a contour is invisible ink
  // that only complicates the outline.
  const minArea = (context.unitsPerEm * 0.012) ** 2
  const issues: Issue[] = []
  glyph.outline.contours.forEach((contour, contourIndex) => {
    const area = Math.abs(contourSignedArea(contour))
    if (area > 0 && area < minArea) {
      issues.push(
        issue(
          ISSUE_CODE.TinyContour,
          'warning',
          glyph,
          'Tiny contour',
          `Contour ${contourIndex + 1} encloses only ${Math.round(area)} square units and is probably a leftover.`,
          { contourIndex, point: nodePoint(contour.nodes[0]) },
        ),
      )
    }
  })
  return issues
}

function checkMalformedCurves(
  glyph: ResolvedGlyph,
  context: GlyphCheckContext,
): Issue[] {
  const issues: Issue[] = []
  const huge = context.unitsPerEm * 4

  glyph.outline.contours.forEach((contour, contourIndex) => {
    for (const node of contour.nodes) {
      for (const handle of [node.in, node.out]) {
        if (!handle) continue
        if (!Number.isFinite(handle.x) || !Number.isFinite(handle.y)) {
          issues.push(
            issue(
              ISSUE_CODE.MalformedCurve,
              'error',
              glyph,
              'Invalid control point',
              'A Bezier handle has a non-finite coordinate.',
              { contourIndex, nodeId: node.id, point: nodePoint(node) },
            ),
          )
          continue
        }
        if (distance(nodePoint(node), handle) > huge) {
          issues.push(
            issue(
              ISSUE_CODE.MalformedCurve,
              'warning',
              glyph,
              'Runaway handle',
              `A Bezier handle extends ${Math.round(distance(nodePoint(node), handle))} units from its node, far beyond the em.`,
              { contourIndex, nodeId: node.id, point: nodePoint(node) },
            ),
          )
        }
      }
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        issues.push(
          issue(
            ISSUE_CODE.MalformedCurve,
            'error',
            glyph,
            'Invalid node',
            'An on-curve point has a non-finite coordinate.',
            { contourIndex, nodeId: node.id },
          ),
        )
      }
    }
  })
  return issues
}

/**
 * Checks winding against the font's own convention. TrueType fills outers
 * clockwise and PostScript fills them counter-clockwise; either is fine, but
 * being inconsistent within one font is not.
 */
function checkContourDirection(
  glyph: ResolvedGlyph,
  context: GlyphCheckContext,
): Issue[] {
  if (glyph.outline.contours.length === 0) return []
  const expectOuterClockwise = context.outlineFormat === 'truetype'
  const depths = contourNestingDepths(glyph.outline)
  const issues: Issue[] = []

  glyph.outline.contours.forEach((contour, contourIndex) => {
    const area = contourSignedArea(contour)
    if (Math.abs(area) < 1e-6) return
    const isOuter = depths[contourIndex] % 2 === 0
    const isClockwise = area < 0
    const shouldBeClockwise = isOuter === expectOuterClockwise

    if (isClockwise !== shouldBeClockwise) {
      // With one contour the winding cannot change what fills, so this is
      // only a consistency note. With several, a wrong direction turns a
      // counter into ink or vice versa.
      const severity =
        glyph.outline.contours.length === 1 ? 'info' : 'warning'
      issues.push(
        issue(
          ISSUE_CODE.ContourDirection,
          severity,
          glyph,
          'Suspicious contour direction',
          `Contour ${contourIndex + 1} is ${isOuter ? 'an outer contour' : 'a counter'} running ${
            isClockwise ? 'clockwise' : 'counter-clockwise'
          }, which is the opposite of this font's ${
            context.outlineFormat === 'truetype' ? 'TrueType' : 'PostScript'
          } convention.${
            glyph.outline.contours.length === 1
              ? ' A single contour still fills correctly.'
              : ' It may fill incorrectly.'
          }`,
          { contourIndex, point: nodePoint(contour.nodes[0]) },
        ),
      )
    }
  })
  return issues
}

/**
 * Overlapping contours are not the same thing as a broken contour.
 *
 * Building an accented glyph by laying the accent over the base is standard
 * practice and renders correctly under the non-zero fill rule, so contour
 * overlap is reported as information for anyone who needs a clean, non
 * overlapping outline. A contour crossing *itself* is a genuine defect: it
 * reverses winding partway round and leaves a hole where ink was intended.
 */
function checkSelfIntersections(glyph: ResolvedGlyph): Issue[] {
  const found = findSelfIntersections(glyph.outline, { limit: 8 })
  const sameContour = found.filter((i) => i.contourA === i.contourB)
  const crossContour = found.filter((i) => i.contourA !== i.contourB)

  const issues = sameContour.map((intersection) =>
    issue(
      ISSUE_CODE.SelfIntersection,
      'warning',
      glyph,
      'Contour crosses itself',
      `Contour ${intersection.contourA + 1} crosses itself, which reverses the fill part way round.`,
      { contourIndex: intersection.contourA, point: intersection.point },
    ),
  )

  if (crossContour.length > 0) {
    const first = crossContour[0]
    issues.push(
      issue(
        ISSUE_CODE.SelfIntersection,
        'info',
        glyph,
        'Overlapping contours',
        `${crossContour.length} place${crossContour.length === 1 ? '' : 's'} where separate contours overlap. This fills correctly, but the outline is not a clean single shape.`,
        { contourIndex: first.contourA, point: first.point },
      ),
    )
  }

  return issues
}

function checkMetrics(
  glyph: ResolvedGlyph,
  context: GlyphCheckContext,
): Issue[] {
  const issues: Issue[] = []

  if (!Number.isFinite(glyph.advanceWidth)) {
    issues.push(
      issue(
        ISSUE_CODE.InvalidMetrics,
        'error',
        glyph,
        'Invalid advance width',
        'The advance width is not a number and the font cannot be exported.',
      ),
    )
    return issues
  }
  if (glyph.advanceWidth < 0) {
    issues.push(
      issue(
        ISSUE_CODE.InvalidMetrics,
        'error',
        glyph,
        'Negative advance width',
        `The advance width is ${Math.round(glyph.advanceWidth)}. Advance widths cannot be negative.`,
      ),
    )
  }
  // Combining marks are drawn with a zero advance on purpose, and maths
  // fonts do the same for pieces that are positioned by GPOS, so this is
  // information rather than a fault.
  const isMark = glyph.unicode !== null && isCombiningMark(glyph.unicode)
  if (!glyph.isEmpty && glyph.advanceWidth === 0 && !isMark) {
    issues.push(
      issue(
        ISSUE_CODE.InvalidMetrics,
        'info',
        glyph,
        'Zero advance on a drawn glyph',
        'This glyph has an outline but no advance width. That is deliberate for marks and for pieces positioned by OpenType features, but unusual otherwise.',
      ),
    )
  }

  if (!glyph.isEmpty) {
    const inkWidth = glyph.bounds.xMax - glyph.bounds.xMin
    if (inkWidth > glyph.advanceWidth * 3 && glyph.advanceWidth > 0) {
      issues.push(
        issue(
          ISSUE_CODE.InvalidMetrics,
          'info',
          glyph,
          'Ink far wider than the advance',
          `The outline is ${Math.round(inkWidth)} units wide but the advance is only ${Math.round(glyph.advanceWidth)}.`,
        ),
      )
    }
    const limit = context.unitsPerEm * 4
    if (
      Math.abs(glyph.bounds.yMax) > limit ||
      Math.abs(glyph.bounds.yMin) > limit
    ) {
      issues.push(
        issue(
          ISSUE_CODE.InvalidMetrics,
          'warning',
          glyph,
          'Outline far outside the em',
          `The outline spans ${Math.round(glyph.bounds.yMin)} to ${Math.round(glyph.bounds.yMax)} vertically.`,
        ),
      )
    }
  }

  return issues
}

export function checkGlyph(
  glyph: ResolvedGlyph,
  context: GlyphCheckContext,
): Issue[] {
  if (glyph.isEmpty) return checkMetrics(glyph, context)
  return [
    ...checkOpenContours(glyph),
    ...checkDuplicateNodes(glyph, context),
    ...checkTinyContours(glyph, context),
    ...checkMalformedCurves(glyph, context),
    ...checkContourDirection(glyph, context),
    ...checkSelfIntersections(glyph),
    ...checkMetrics(glyph, context),
  ]
}

/** Exposed for the consistency pass, which needs per-contour segment counts. */
export function contourStats(outline: Outline): Array<{
  contour: Contour
  segments: number
  area: number
}> {
  return outline.contours.map((contour) => ({
    contour,
    segments: contourSegments(contour).length,
    area: Math.abs(contourSignedArea(contour)),
  }))
}
