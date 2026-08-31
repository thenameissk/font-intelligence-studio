/**
 * The seam for a future font assistant.
 *
 * Nothing in this application calls out to a model, and nothing needs to:
 * every analysis, transformation and check is deterministic and local. This
 * interface exists so that an assistant can later be added *alongside* that
 * engine rather than inside it.
 *
 * The contract is deliberately narrow. An assistant may:
 *   - read the analysis the local engine already produced
 *   - propose operations, expressed as the same `TransformSpec` values the
 *     UI already knows how to preview, apply and undo
 *
 * It may not mutate the document. A proposal is a suggestion the user
 * previews and accepts, which keeps an assistant from being able to damage
 * a font in ways the existing undo and preview machinery cannot reverse.
 */
import type { FontDna } from '@/types/analysis'
import type { ValidationReport } from '@/types/validation'
import type { TransformSpec } from '@/engine/transforms/applySpec'

export interface FontAnalysis {
  dna: FontDna
  validation: ValidationReport | null
}

export interface FontOperation {
  /** The operation, in the same form the transform engine already applies. */
  spec: TransformSpec
  /** Glyph indices it should apply to. */
  targets: number[]
  /** Why this is being suggested, shown to the user before they accept. */
  rationale: string
  /** 0-1. Anything uncertain should say so rather than sound confident. */
  confidence: number
}

export interface FontAssistant {
  readonly name: string
  /** False when no backend is configured; the app must work regardless. */
  readonly available: boolean

  analyzeFont(): Promise<FontAnalysis>
  suggestTransformation(request: string): Promise<FontOperation[]>
}

/**
 * The shipped implementation: local analysis only, no suggestions.
 *
 * `analyzeFont` returns what the deterministic engine already computed, so
 * the interface is useful today; `suggestTransformation` returns nothing,
 * because guessing would be worse than saying "not available".
 */
export function createLocalAssistant(
  getAnalysis: () => FontAnalysis | null,
): FontAssistant {
  return {
    name: 'Local analysis',
    available: false,

    async analyzeFont() {
      const analysis = getAnalysis()
      if (!analysis) {
        throw new Error('No font is open.')
      }
      return analysis
    },

    async suggestTransformation() {
      return []
    },
  }
}
