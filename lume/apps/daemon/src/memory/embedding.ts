import type { Logger } from '../util/logger.js'

export interface EmbeddingClientOptions {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  logger?: Logger
  /** injectable fetch for tests; defaults to globalThis.fetch */
  fetchImpl?: typeof fetch
}

/**
 * Minimal OpenAI-compatible /embeddings client (plain fetch, no SDK).
 *
 * Hard constraint: the request body always carries `encoding_format: 'float'`.
 * Some backends (Xinference) silently reply in a different wire format when
 * the field is omitted, so the response is validated to be a plain number[]
 * before it leaves this class — a base64-shaped reply fails loudly here
 * instead of corrupting the vector store downstream.
 */
export class EmbeddingClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly logger?: Logger
  private readonly fetchImpl: typeof fetch

  constructor(opts: EmbeddingClientOptions) {
    // strip a trailing slash so `${baseUrl}/embeddings` always joins cleanly
    this.baseUrl = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.timeoutMs = opts.timeoutMs
    this.logger = opts.logger
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        // hard constraint: Xinference and friends must not fall back to base64
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `embedding request failed: HTTP ${response.status}` +
          (detail === '' ? '' : `: ${detail.slice(0, 200)}`),
      )
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: unknown }> }
    const embedding = payload.data?.[0]?.embedding
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some((v) => typeof v !== 'number')
    ) {
      throw new Error(
        'embedding response malformed: data[0].embedding must be a non-empty number[] ' +
          '(a string/base64 reply means the backend ignored encoding_format)',
      )
    }
    this.logger?.debug('embedded text', { chars: text.length, dims: embedding.length })
    return embedding as number[]
  }
}
