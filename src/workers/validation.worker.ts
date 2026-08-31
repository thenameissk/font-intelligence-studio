/**
 * Font QA, off the main thread.
 *
 * The worker parses the font once from the sfnt bytes it is handed and keeps
 * it in memory, so re-validating after an edit only ships the edit overlay
 * rather than the whole font. A full pass over a 3,000 glyph font takes a
 * couple of hundred milliseconds, which is exactly the kind of work that
 * should not stall typing or dragging.
 */
import { parseFontFile, type ParsedFont } from '@/engine/parser/parseFont'
import { runValidation } from '@/engine/validation/runValidation'
import type {
  ValidationRequest,
  ValidationResponse,
} from './validationProtocol'

let font: ParsedFont | null = null

function post(message: ValidationResponse): void {
  self.postMessage(message)
}

self.onmessage = async (event: MessageEvent<ValidationRequest>) => {
  const request = event.data
  try {
    if (request.type === 'load') {
      font = await parseFontFile({
        name: request.fileName,
        buffer: request.sfnt,
      })
      post({ type: 'ready', glyphCount: font.glyphs.length })
      return
    }

    if (request.type === 'validate') {
      if (!font) {
        post({
          type: 'error',
          token: request.token,
          message: 'The worker has no font loaded yet.',
        })
        return
      }
      const report = runValidation(font, request.edits)
      post({ type: 'report', token: request.token, report })
    }
  } catch (error) {
    post({
      type: 'error',
      token: request.type === 'validate' ? request.token : null,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
