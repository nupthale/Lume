import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The OpenAI SDK client is mocked at module level: `chat.completions.create`
 * resolves to a stream over `h.chunks` (OpenAI wire-format chunks, one per
 * array entry). `h.failures` holds errors thrown by successive create() calls
 * (one per call) to exercise the provider's stream-setup retry loop; `h.calls`
 * counts create() invocations; `h.breakAt` makes the stream throw after that
 * many chunks to simulate a mid-stream disconnect.
 */
const h = vi.hoisted(() => {
  return {
    chunks: [] as Array<Record<string, unknown>>,
    failures: [] as Array<unknown>,
    breakAt: undefined as number | undefined,
    calls: 0,
  }
})

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: async () => {
          h.calls++
          const failure = h.failures.shift()
          if (failure !== undefined) throw failure
          return {
            async *[Symbol.asyncIterator]() {
              let i = 0
              for (const chunk of h.chunks) {
                if (h.breakAt !== undefined && i >= h.breakAt) {
                  throw new Error('connection dropped mid-stream')
                }
                yield chunk
                i++
              }
            },
          }
        },
      },
    }
  }
  return { default: MockOpenAI }
})

const { OpenAiCompatProvider } = await import('../src/providers/openai-compat.js')
const { aggregateStream, ProviderError } = await import('../src/providers/types.js')

function makeProvider() {
  return new OpenAiCompatProvider({
    baseUrl: 'http://localhost:1/v1',
    apiKey: 'EMPTY',
    model: 'test-model',
    timeoutMs: 1_000,
  })
}

/** one streaming chunk: delta payload + optional finish_reason */
function chunk(delta: Record<string, unknown>, finish?: string) {
  return {
    choices: [{ delta, ...(finish !== undefined ? { finish_reason: finish } : {}) }],
  }
}

function toolCallDelta(index: number, fn: Record<string, unknown>, id?: string) {
  return { index, ...(id !== undefined ? { id } : {}), function: fn }
}

async function run(chunks: Array<Record<string, unknown>>) {
  h.chunks = chunks
  h.failures = []
  h.breakAt = undefined
  h.calls = 0
  const provider = makeProvider()
  return aggregateStream(provider.chat({ messages: [{ role: 'user', content: 'go' }] }))
}

describe('OpenAiCompatProvider tool-call delta forwarding', () => {
  it('forwards argument fragments so the aggregator rebuilds valid JSON', async () => {
    const reply = await run([
      chunk({ tool_calls: [toolCallDelta(0, { name: 'write_file' }, 'call_1')] }),
      chunk({ tool_calls: [toolCallDelta(0, { arguments: '{"path":"a.txt",' })] }),
      chunk({ tool_calls: [toolCallDelta(0, { arguments: '"content":"hi"}' })] }),
      chunk({}, 'tool_calls'),
    ])

    expect(reply.toolCalls).toHaveLength(1)
    const [call] = reply.toolCalls
    expect(call.id).toBe('call_1')
    expect(call.name).toBe('write_file')
    // the exact assertion that guards the harness bug: arguments must parse
    expect(JSON.parse(call.arguments)).toEqual({ path: 'a.txt', content: 'hi' })
    expect(reply.finishReason).toBe('tool_calls')
  })

  it('does not duplicate name fragments streamed in pieces', async () => {
    const reply = await run([
      chunk({ tool_calls: [toolCallDelta(0, { name: 'write_' }, 'call_1')] }),
      chunk({ tool_calls: [toolCallDelta(0, { name: 'file' })] }),
      chunk({ tool_calls: [toolCallDelta(0, { arguments: '{}' })] }),
      chunk({}, 'tool_calls'),
    ])

    expect(reply.toolCalls[0]?.name).toBe('write_file')
  })

  it('keeps parallel tool calls separated by index', async () => {
    const reply = await run([
      chunk({ tool_calls: [toolCallDelta(0, { name: 'bash' }, 'call_1')] }),
      chunk({ tool_calls: [toolCallDelta(1, { name: 'write_file' }, 'call_2')] }),
      chunk({ tool_calls: [toolCallDelta(0, { arguments: '{"command":"ls"}' })] }),
      chunk({ tool_calls: [toolCallDelta(1, { arguments: '{"path":"b.txt"}' })] }),
      chunk({}, 'tool_calls'),
    ])

    expect(reply.toolCalls).toHaveLength(2)
    expect(reply.toolCalls[0]).toMatchObject({ id: 'call_1', name: 'bash' })
    expect(reply.toolCalls[1]).toMatchObject({ id: 'call_2', name: 'write_file' })
    expect(JSON.parse(reply.toolCalls[0]?.arguments ?? '')).toEqual({ command: 'ls' })
    expect(JSON.parse(reply.toolCalls[1]?.arguments ?? '')).toEqual({ path: 'b.txt' })
  })

  it('defaults finishReason to stop only for tool-free streams', async () => {
    const withTools = await run([
      chunk({ tool_calls: [toolCallDelta(0, { name: 'bash' }, 'call_1')] }),
    ])
    expect(withTools.finishReason).toBeUndefined()

    const plain = await run([chunk({ content: 'hi' })])
    expect(plain.finishReason).toBe('stop')
  })
})

/** fetch-level network failure, as thrown through the SDK (TypeError or APIConnectionError) */
function netError(msg: string): Error {
  return Object.assign(new TypeError(msg), { name: 'APIConnectionError' })
}

/** SDK-style HTTP error with a machine-readable status */
function apiError(status: number, message = `HTTP ${status}`): Error {
  return Object.assign(new Error(message), { name: 'APIError', status })
}

describe('OpenAiCompatProvider stream-setup retry', () => {
  afterEach(() => {
    vi.useRealTimers()
    h.failures = []
    h.breakAt = undefined
    h.chunks = []
  })

  it('retries connection failures and succeeds on the third attempt', async () => {
    vi.useFakeTimers()
    h.calls = 0
    h.failures = [netError('ECONNRESET'), netError('socket hang up')]
    h.chunks = [chunk({ content: 'recovered' })]
    const provider = makeProvider()
    const pending = aggregateStream(
      provider.chat({ messages: [{ role: 'user', content: 'go' }] }),
    )
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1_000)

    const reply = await pending
    expect(reply.content).toBe('recovered')
    expect(h.calls).toBe(3)
  })

  it('retries HTTP 429 with 500ms then 1000ms backoff', async () => {
    vi.useFakeTimers()
    h.calls = 0
    h.failures = [apiError(429), apiError(429)]
    h.chunks = [chunk({ content: 'ok' })]
    const provider = makeProvider()
    const pending = aggregateStream(
      provider.chat({ messages: [{ role: 'user', content: 'go' }] }),
    )

    await vi.advanceTimersByTimeAsync(499)
    expect(h.calls).toBe(1) // still inside the first 500ms backoff
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(h.calls).toBe(2) // still inside the second 1000ms backoff
    await vi.advanceTimersByTimeAsync(1)

    const reply = await pending
    expect(reply.content).toBe('ok')
    expect(h.calls).toBe(3)
  })

  it('gives up after 3 attempts and surfaces the last error', async () => {
    vi.useFakeTimers()
    h.calls = 0
    h.failures = [netError('boom 1'), netError('boom 2'), netError('boom 3')]
    const provider = makeProvider()
    const pending = aggregateStream(
      provider.chat({ messages: [{ role: 'user', content: 'go' }] }),
    )
    // attach the rejection handler before advancing: the promise rejects
    // while timers advance, and an unhandled rejection would otherwise fire
    const asserted = expect(pending).rejects.toThrow(/boom 3/)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1_000)
    await asserted
    expect(h.calls).toBe(3)
  })

  it('does not retry non-429 4xx errors', async () => {
    h.calls = 0
    h.failures = [apiError(400, 'invalid request')]
    h.chunks = []
    const provider = makeProvider()
    await expect(
      aggregateStream(provider.chat({ messages: [{ role: 'user', content: 'go' }] })),
    ).rejects.toThrow(ProviderError)
    expect(h.calls).toBe(1)
  })

  it('does not retry once the stream has started producing chunks', async () => {
    h.calls = 0
    h.failures = []
    h.chunks = [chunk({ content: 'partial' }), chunk({ content: 'more' })]
    h.breakAt = 1
    const provider = makeProvider()
    const seen: string[] = []
    await expect(
      aggregateStream(provider.chat({ messages: [{ role: 'user', content: 'go' }] }), {
        onTextDelta: (d) => seen.push(d),
      }),
    ).rejects.toThrow(ProviderError)
    expect(h.calls).toBe(1) // no re-create: the stream already yielded data
    expect(seen).toEqual(['partial'])
  })

  it('stops retrying immediately when the signal aborts during backoff', async () => {
    vi.useFakeTimers()
    h.calls = 0
    h.failures = [netError('ECONNRESET')]
    h.chunks = [chunk({ content: 'never' })]
    const provider = makeProvider()
    const controller = new AbortController()
    const pending = aggregateStream(
      provider.chat({
        messages: [{ role: 'user', content: 'go' }],
        signal: controller.signal,
      }),
    )
    await vi.advanceTimersByTimeAsync(100) // first failure happened; now in backoff
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    expect(h.calls).toBe(1)
  })
})
