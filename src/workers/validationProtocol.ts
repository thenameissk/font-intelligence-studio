/** Message contract between the app and the validation worker. */
import type { GlyphEdits } from '@/types/font'
import type { ValidationReport } from '@/types/validation'

export type ValidationRequest =
  | {
      type: 'load'
      /** Plain sfnt bytes. Transferred, so the caller must send a copy. */
      sfnt: ArrayBuffer
      fileName: string
    }
  | { type: 'validate'; token: number; edits: GlyphEdits }

export type ValidationResponse =
  | { type: 'ready'; glyphCount: number }
  | { type: 'report'; token: number; report: ValidationReport }
  | { type: 'error'; token: number | null; message: string }
