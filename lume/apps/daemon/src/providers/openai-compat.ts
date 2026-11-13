import OpenAI from 'openai'
import type { Logger } from '../util/logger.js'
import { InlineThinkSplitter } from './inline-think.js'
import {
  type ChatMessage,
  type ChatOptions,
  type LlmProvider,
  type ProviderChunk,
  ProviderError,
  type ToolSchema,
} from './types.js'

interface OpenAiCompatOptions {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  logger?: Logger
}

/**
 * Stream-setup retry policy: 3 attempts total, backoff between them.
 * Only errors that occur before the stream produces anything are retried
 * (connection failures, timeouts, HTTP 429 and 5xx); 4xx config/auth errors
 * and mid-stream failures are surfaced immediately.
 */
const RETRY_DELAYS_MS = [500, 1_000]

/**
 * OpenAI-compatible provider (works with OpenAI, vLLM, Xinference, Ollama, ...).
 *
 * Reasoning compatibility:
 * 1. native `reasoning_content` delta field (DeepSeek-style) is preferred;
 * 2. otherwise an InlineThinkSplitter classifies think-tag-prefixed content
 *    (Xinference qwen3 style) into reasoning vs text pieces.
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly name = 'openai-compat'
  private readonly client: OpenAI
  private readonly model: string
  private readonly logger?: Logger

  constructor(opts: OpenAiCompatOptions) {
    this.model = opts.model
    this.logger = opts.logger
    this.client = new OpenAI({
      baseURL: opts.baseUrl,
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs,
      // retries are owned by createStream (fixed 3-attempt policy) so the
      // SDK's own retry loop does not multiply the attempt count
      maxRetries: 0,
    })
  }

  async *chat(options: ChatOptions): AsyncIterable<ProviderChunk> {
    const stream = await this.createStream(options)
    const splitter = new InlineThinkSplitter()
    const toolCallIndexes = new Set<number>()
    let finishReason: string | undefined
    let sawNativeReasoning = false

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta as Record<string, unknown> | undefined

        const nativeReasoning =
          typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : undefined
        if (nativeReasoning !== undefined) {
          sawNativeReasoning = true
          if (nativeReasoning.length > 0) {
            yield { type: 'reasoning_delta', delta: nativeReasoning }
          }
        }

        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          if (sawNativeReasoning) {
            yield { type: 'text_delta', delta: delta.content }
          } else {
            for (const piece of splitter.push(delta.content)) {
              yield piece.kind === 'text'
                ? { type: 'text_delta', delta: piece.value }
                : { type: 'reasoning_delta', delta: piece.value }
            }
          }
        }

        for (const tc of (delta?.tool_calls as Array<Record<string, unknown>> | undefined) ?? []) {
          const index = typeof tc.index === 'number' ? tc.index : 0
          const fn = tc.function as Record<string, unknown> | undefined
          // pure pass-through: aggregation (id/name/arguments assembly) is the
          // consumer's job via aggregateStream, exactly like FakeProvider
          toolCallIndexes.add(index)
          yield {
            type: 'tool_call_delta',
            index,
            id: typeof tc.id === 'string' && tc.id ? tc.id : undefined,
            name: typeof fn?.name === 'string' && fn.name ? fn.name : undefined,
            argumentsDelta: typeof fn?.arguments === 'string' ? fn.arguments : undefined,
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason
      }
    } catch (err) {
      throw this.toProviderError(err)
    } finally {
      for (const piece of splitter.end()) {
        yield piece.kind === 'text'
          ? { type: 'text_delta', delta: piece.value }
          : { type: 'reasoning_delta', delta: piece.value }
      }
      if (finishReason === undefined && toolCallIndexes.size === 0) {
        // stream ended without explicit finish reason; keep aggregator simple
        finishReason = 'stop'
      }
    }

    yield { type: 'done', finishReason }
  }

  private async createStream(
    options: ChatOptions,
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const delays = [...RETRY_DELAYS_MS]
    for (let attempt = 1; ; attempt++) {
      try {
        // each attempt rebuilds the request body from scratch (messages are
        // never consumed), so the previous failed request cannot leak state
        return await this.client.chat.completions.create(
          {
            model: this.model,
            messages: options.messages.map((m) => this.toOpenAiMessage(m)),
            ...(options.tools && options.tools.length > 0
              ? { tools: options.tools.map((t) => this.toOpenAiTool(t)) }
              : {}),
            stream: true,
            ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
          },
          { signal: options.signal },
        )
      } catch (err) {
        // abort during a previous backoff surfaces as ProviderError already
        if (err instanceof ProviderError) throw err
        const delayMs = delays.shift()
        if (delayMs === undefined || !this.isRetryableStreamSetupError(err)) {
          throw this.toProviderError(err)
        }
        this.logger?.warn('stream setup failed, retrying', {
          attempt,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        })
        await this.backoff(delayMs, options.signal)
      }
    }
  }

  /** Connection-level failures, timeouts and HTTP 429/5xx are worth retrying. */
  private isRetryableStreamSetupError(err: unknown): boolean {
    if (this.isAbort(err)) return false
    if (err instanceof TypeError) return true // fetch-level network failure
    const name = err instanceof Error ? err.name : ''
    if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true
    const status = (err as { status?: unknown }).status
    return typeof status === 'number' && (status === 429 || status >= 500)
  }

  /** setTimeout-based wait that rejects immediately when the signal aborts. */
  private backoff(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => {
        if (timer !== undefined) clearTimeout(timer)
        reject(new ProviderError('request aborted'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private toOpenAiMessage(m: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    switch (m.role) {
      case 'system':
        return { role: 'system', content: m.content }
      case 'user':
        return { role: 'user', content: m.content }
      case 'tool':
        return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' }
      case 'assistant': {
        const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: m.content,
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          }))
        }
        return msg
      }
    }
  }

  private toOpenAiTool(t: ToolSchema): OpenAI.Chat.Completions.ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as Record<string, never>,
      },
    }
  }

  private toProviderError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err
    if (this.isAbort(err)) return new ProviderError('request aborted')
    const message = err instanceof Error ? err.message : String(err)
    this.logger?.warn('provider request failed', { error: message })
    return new ProviderError(`LLM request failed: ${message}`)
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')
  }
}
