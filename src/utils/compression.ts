/** zlib deflate/inflate via the platform Compression Streams API. */

async function runStream(
  data: Uint8Array,
  stream: TransformStream<BufferSource, Uint8Array>,
): Promise<Uint8Array> {
  const source = new Blob([data as unknown as BlobPart]).stream()
  const response = new Response(
    source.pipeThrough(stream) as unknown as ReadableStream<Uint8Array>,
  )
  return new Uint8Array(await response.arrayBuffer())
}

export function supportsCompressionStreams(): boolean {
  return (
    typeof DecompressionStream !== 'undefined' &&
    typeof CompressionStream !== 'undefined'
  )
}

/** Inflate zlib-wrapped deflate data (RFC 1950), as used by WOFF 1.0. */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  return runStream(data, new DecompressionStream('deflate'))
}

/** Deflate to zlib-wrapped data (RFC 1950), as required by WOFF 1.0. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return runStream(data, new CompressionStream('deflate'))
}
