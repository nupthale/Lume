/**
 * LLM provider abstraction. Streaming-first: the agent consumes chunks and
 * aggregates them itself, so frontends can render deltas as they arrive.
 */

export interface ToolCallPayload {
  /** provider-issued id, echoed back on the tool result message */
  id: string
  name: string
  /** raw JSON string of arguments (may be invalid JSON; validated later) */
  arguments: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** present on assistant messages that requested tools */
  toolCalls?: ToolCallPayload[]
  /** present on tool result messages */
  toolCallId?: string
  name?: string
}

export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    /** JSON Schema for the parameters object */
    parameters: Record<string, unknown>
  }
}

export type ProviderChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | {
      type: 'tool_call_delta'
      index: number
      id?: string
      name?: string
      argumentsDelta?: string
    }
  | { type: 'done'; finishReason?: string }

export interface AssistantReply {
  content: string
  reasoning: string
  toolCalls: ToolCallPayload[]
  finishReason?: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  tools?: ToolSchema[]
  signal?: AbortSignal
  maxTokens?: number
}

export interface LlmProvider {
  readonly name: string
  /** Streams a completion. Throws on transport/config errors. */
  chat(options: ChatOptions): AsyncIterable<ProviderChunk>
}

export class ProviderError extends Error {
  readonly timeout: boolean
  constructor(message: string, opts: { timeout?: boolean } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.timeout = opts.timeout ?? false
  }
}

/** Aggregate a provider stream into a complete reply, invoking hooks per chunk. */
export async function aggregateStream(
  stream: AsyncIterable<ProviderChunk>,
  hooks: {
    onTextDelta?: (delta: string) => void
    onReasoningDelta?: (delta: string) => void
  } = {},
): Promise<AssistantReply> {
  let content = ''
  let reasoning = ''
  let finishReason: string | undefined
  const toolCalls = new Map<number, ToolCallPayload>()

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text_delta':
        content += chunk.delta
        hooks.onTextDelta?.(chunk.delta)
        break
      case 'reasoning_delta':
        reasoning += chunk.delta
        hooks.onReasoningDelta?.(chunk.delta)
        break
      case 'tool_call_delta': {
        const existing = toolCalls.get(chunk.index) ?? {
          id: '',
          name: '',
          arguments: '',
        }
        if (chunk.id !== undefined) existing.id = chunk.id
        if (chunk.name !== undefined) existing.name += chunk.name
        if (chunk.argumentsDelta !== undefined) existing.arguments += chunk.argumentsDelta
        toolCalls.set(chunk.index, existing)
        break
      }
      case 'done':
        finishReason = chunk.finishReason
        break
    }
  }

  return {
    content,
    reasoning,
    toolCalls: [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, tc]) => tc),
    finishReason,
  }
}
