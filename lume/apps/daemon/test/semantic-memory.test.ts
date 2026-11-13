import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { buildTurnContext } from '../src/memory/context.js'
import { EmbeddingClient } from '../src/memory/embedding.js'
import { makeSaveMemoryTool } from '../src/memory/save-memory-tool.js'
import { recallFacts, saveFact } from '../src/memory/semantic.js'
import { type SessionRow, SqliteStore } from '../src/memory/store.js'
import { cosine, decodeFloat32, encodeFloat32 } from '../src/memory/vector.js'
import { makeUpdateWorkingMemoryTool } from '../src/memory/working-memory-tool.js'
import { type FakeReply, FakeProvider } from '../src/providers/fake.js'
import type { AssistantReply, ChatMessage } from '../src/providers/types.js'
import type { OutboundEvent } from '@lume/protocol'
import { PermissionPolicy } from '../src/core/permission.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { ToolError } from '../src/tools/types.js'
import { createLogger } from '../src/util/logger.js'
import { ulid } from '../src/util/ulid.js'

const logger = createLogger('error')

function reply(partial: Partial<AssistantReply>): AssistantReply {
  return { content: '', reasoning: '', toolCalls: [], finishReason: 'stop', ...partial }
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return ConfigSchema.parse({
    apiBaseUrl: 'http://localhost:1/v1',
    model: 'test-model',
    cwd: '/tmp',
    ...overrides,
  })
}

/** in-memory store preloaded with one session */
function makeStore(): { store: SqliteStore; session: SessionRow } {
  const store = new SqliteStore(':memory:')
  const session = store.createSession({ id: ulid(), cwd: '/tmp', model: 'test-model' })
  return { store, session }
}

/** deterministic embedder: maps each text to a fixed vector via `embed` */
function fakeEmbedder(embed: (text: string) => number[]): EmbeddingClient {
  return {
    async embed(text: string): Promise<number[]> {
      return embed(text)
    },
  } as unknown as EmbeddingClient
}

function toolCtx() {
  return { cwd: '/tmp', signal: new AbortController().signal, maxOutputChars: 2000 }
}

/* ------------------------------------------------------------------ vector */

describe('vector helpers', () => {
  it('round-trips a vector through little-endian float32', () => {
    const vec = [0.1, -0.2, 0.3, 0, 1]
    const decoded = decodeFloat32(encodeFloat32(vec))
    // float32 precision: compare against the f32-rounded values, not the inputs
    expect(decoded).toEqual([...new Float32Array(vec)])
  })

  it('encodes 1.0 in the documented little-endian byte layout', () => {
    expect([...encodeFloat32([1])]).toEqual([0x00, 0x00, 0x80, 0x3f])
  })

  it('scores orthogonal / parallel / opposite / zero vector pairs', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0) // orthogonal
    expect(cosine([2, 0], [3, 0])).toBe(1) // parallel (scale invariant)
    expect(cosine([1, 0], [-1, 0])).toBe(-1) // opposite
    expect(cosine([0, 0], [1, 1])).toBe(0) // zero vector has no direction
    expect(cosine([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2) // diagonal sanity
  })
})

/* -------------------------------------------------------- embedding client */

describe('EmbeddingClient', () => {
  function makeClient(
    fetchImpl: typeof fetch,
    baseUrl = 'http://embed.test/v1',
  ): EmbeddingClient {
    return new EmbeddingClient({
      baseUrl,
      apiKey: 'test-key',
      model: 'test-embed-model',
      timeoutMs: 5_000,
      fetchImpl,
    })
  }

  it('POSTs to {base}/embeddings with encoding_format float and returns the float array', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = makeClient(
      async (input, init) => {
        calls.push({ url: String(input), init: init as RequestInit })
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
          status: 200,
        })
      },
    )

    const vec = await client.embed('hello world')

    expect(vec).toEqual([0.1, 0.2, 0.3])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://embed.test/v1/embeddings')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-key')
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body).toEqual({
      model: 'test-embed-model',
      input: 'hello world',
      encoding_format: 'float',
    })
  })

  it('strips a trailing slash from the base url', async () => {
    const urls: string[] = []
    const client = makeClient(
      async (input) => {
        urls.push(String(input))
        return new Response(JSON.stringify({ data: [{ embedding: [1] }] }))
      },
      'http://embed.test/v1/',
    )

    await client.embed('x')
    expect(urls).toEqual(['http://embed.test/v1/embeddings'])
  })

  it('rejects a string/base64-shaped embedding payload instead of storing garbage', async () => {
    const client = makeClient(
      async () => new Response(JSON.stringify({ data: [{ embedding: 'QUJDRA==' }] })),
    )

    await expect(client.embed('x')).rejects.toThrow(/data\[0\]\.embedding/)
  })

  it('throws with the HTTP status on a non-2xx reply', async () => {
    const client = makeClient(async () => new Response('not found', { status: 404 }))

    await expect(client.embed('x')).rejects.toThrow(/HTTP 404/)
  })
})

/* ---------------------------------------------------------------- saveFact */

describe('saveFact', () => {
  it('embeds and writes a new fact with a decodable float32 blob', async () => {
    const { store, session } = makeStore()
    const embedder = fakeEmbedder(() => [0, 1])

    const result = await saveFact(
      { embedder, store },
      { content: 'The user lives in Shanghai.', sessionId: session.id },
    )

    expect(result).toEqual({ saved: true, reason: 'saved' })
    const facts = store.listFacts()
    expect(facts).toHaveLength(1)
    expect(facts[0]?.content).toBe('The user lives in Shanghai.')
    expect(facts[0]?.sessionId).toBe(session.id)
    expect(decodeFloat32(facts[0]!.embedding!)).toEqual([0, 1])
  })

  it('skips writing when an existing fact is near-identical (cosine > 0.92)', async () => {
    const { store, session } = makeStore()
    store.insertFact({
      id: ulid(),
      content: 'The user is allergic to peanuts.',
      embedding: encodeFloat32([1, 0]),
      sessionId: session.id,
    })
    // cos([1,0], [0.9999, ~0.0141]) ~= 0.9999 -> duplicate
    const embedder = fakeEmbedder(() => [0.9999, 0.014142135623730951])

    const result = await saveFact(
      { embedder, store },
      { content: 'User has a peanut allergy.', sessionId: session.id },
    )

    expect(result).toEqual({
      saved: false,
      reason: 'duplicate',
      similarTo: 'The user is allergic to peanuts.',
    })
    expect(store.listFacts()).toHaveLength(1) // nothing new written
  })

  it('writes when existing facts carry no embeddings (saved while Layer 3 was off)', async () => {
    const { store, session } = makeStore()
    store.insertFact({
      id: ulid(),
      content: 'legacy fact without an embedding',
      sessionId: session.id,
    })
    const embedder = fakeEmbedder(() => [1, 0])

    const result = await saveFact(
      { embedder, store },
      { content: 'The user is allergic to peanuts.', sessionId: session.id },
    )

    expect(result).toEqual({ saved: true, reason: 'saved' })
    expect(store.listFacts().map((f) => f.content)).toEqual([
      'legacy fact without an embedding',
      'The user is allergic to peanuts.',
    ])
  })
})

/* ------------------------------------------------------------- recallFacts */

describe('recallFacts', () => {
  it('returns [] without calling the embedder when the library has no embedded facts', async () => {
    const { store, session } = makeStore()
    store.insertFact({ id: ulid(), content: 'saved while Layer 3 was off', sessionId: session.id })
    const embedded: string[] = []
    const embedder = fakeEmbedder((text) => {
      embedded.push(text)
      return [1, 0]
    })

    expect(await recallFacts({ embedder, store }, 'any query')).toEqual([])
    expect(embedded).toEqual([]) // the embed round-trip was skipped entirely
  })

  it('returns top-K facts above the similarity threshold, sorted descending', async () => {
    const { store, session } = makeStore()
    const seed: Array<[string, number[]]> = [
      ['The user likes spicy food.', [1, 0]],
      ['The user works on the lume daemon.', [Math.SQRT1_2, Math.SQRT1_2]],
      ['The user has a dog.', [0, 1]], // orthogonal -> filtered at 0.35
      ['The user drinks coffee.', [0.3, Math.sqrt(0.91)]], // sim 0.3 -> filtered
    ]
    for (const [content, vec] of seed) {
      store.insertFact({ id: ulid(), content, embedding: encodeFloat32(vec), sessionId: session.id })
    }
    const embedder = fakeEmbedder(() => [1, 0])

    // defaults: topK 5, minSim 0.35 -> only the two similar facts, best first
    expect(await recallFacts({ embedder, store }, 'food preferences')).toEqual([
      'The user likes spicy food.',
      'The user works on the lume daemon.',
    ])
    // topK 1 keeps only the best match
    expect(await recallFacts({ embedder, store }, 'food preferences', { topK: 1 })).toEqual([
      'The user likes spicy food.',
    ])
    // a higher minSim drops the 0.707 fact as well
    expect(await recallFacts({ embedder, store }, 'food preferences', { minSim: 0.9 })).toEqual([
      'The user likes spicy food.',
    ])
  })

  it('ignores facts stored without embeddings', async () => {
    const { store, session } = makeStore()
    store.insertFact({ id: ulid(), content: 'legacy fact without an embedding', sessionId: session.id })
    store.insertFact({
      id: ulid(),
      content: 'The user is allergic to peanuts.',
      embedding: encodeFloat32([1, 0]),
      sessionId: session.id,
    })
    const embedder = fakeEmbedder(() => [1, 0])

    expect(await recallFacts({ embedder, store }, 'lunch ideas')).toEqual([
      'The user is allergic to peanuts.',
    ])
  })
})

/* ------------------------------------------------------- save_memory tool */

describe('save_memory (tool)', () => {
  it('saves the fact and reports it', async () => {
    const { store, session } = makeStore()
    const registry = new ToolRegistry([
      makeSaveMemoryTool({ embedder: fakeEmbedder(() => [1, 0]), store, session }),
    ])

    const result = await registry.execute(
      'save_memory',
      { content: 'The user is allergic to peanuts.' },
      toolCtx(),
    )

    expect(result.output).toContain('saved')
    expect(result.output).toContain('The user is allergic to peanuts.')
    expect(store.listFacts().map((f) => f.content)).toEqual(['The user is allergic to peanuts.'])
  })

  it('treats a duplicate as a skipped non-error', async () => {
    const { store, session } = makeStore()
    const registry = new ToolRegistry([
      makeSaveMemoryTool({ embedder: fakeEmbedder(() => [1, 0]), store, session }),
    ])

    await registry.execute(
      'save_memory',
      { content: 'The user is allergic to peanuts.' },
      toolCtx(),
    )
    const result = await registry.execute(
      'save_memory',
      { content: 'User has a peanut allergy.' },
      toolCtx(),
    )

    expect(result.output).toBe('skipped: similar memory already exists')
    expect(store.listFacts()).toHaveLength(1)
  })

  it('surfaces embedder failures as ToolError without writing', async () => {
    const { store, session } = makeStore()
    const broken = fakeEmbedder(() => {
      throw new Error('embedding backend down')
    })
    const registry = new ToolRegistry([makeSaveMemoryTool({ embedder: broken, store, session })])

    await expect(registry.execute('save_memory', { content: 'x' }, toolCtx())).rejects.toThrow(
      ToolError,
    )
    await expect(registry.execute('save_memory', { content: 'x' }, toolCtx())).rejects.toThrow(
      /embedding backend down/,
    )
    expect(store.listFacts()).toHaveLength(0)
  })

  it('is read-risk, so the policy auto-approves it', () => {
    const { store, session } = makeStore()
    const tool = makeSaveMemoryTool({ embedder: fakeEmbedder(() => [1]), store, session })
    expect(tool.risk).toBe('read')
    expect(new PermissionPolicy().requiresApproval(tool.name, tool.risk)).toBe(false)
  })
})

/* ------------------------------------------------------- agent integration */

describe('Layer 3 agent integration', () => {
  function makeMemoryAgent(
    store: SqliteStore,
    session: SessionRow,
    script: FakeReply[],
    opts: { embedder?: EmbeddingClient; tools?: ToolRegistry } = {},
  ): { agent: Agent; events: OutboundEvent[] } {
    const events: OutboundEvent[] = []
    const frontend: Frontend = {
      emit: (e) => events.push(e),
      requestPermission: async () => false,
    }
    const agent = new Agent({
      provider: new FakeProvider(script),
      tools: opts.tools ?? new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig(),
      logger,
      memory: { store, session },
      ...(opts.embedder !== undefined ? { embedder: opts.embedder } : {}),
    })
    agent.attachFrontend(frontend)
    return { agent, events }
  }

  async function runTurn(agent: Agent, content: string): Promise<void> {
    agent.submit(content)
    while (agent.isBusy) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  it('saves a fact through save_memory and recalls it into the next turn', async () => {
    const { store, session } = makeStore()
    const FACT = 'The user is allergic to peanuts.'
    const embedded: string[] = []
    // deterministic 2-d space: the saved fact is [1,0]; a later "lunch"
    // question lands nearby ([0.99, 0.1] -> cos ~= 0.995)
    const embedder = fakeEmbedder((text) => {
      embedded.push(text)
      return text === FACT ? [1, 0] : [0.99, 0.1]
    })
    let secondTurnMessages: ChatMessage[] | undefined
    const { agent, events } = makeMemoryAgent(
      store,
      session,
      [
        reply({
          content: 'Saving that.',
          toolCalls: [
            { id: 'sm1', name: 'save_memory', arguments: JSON.stringify({ content: FACT }) },
          ],
          finishReason: 'tool_calls',
        }),
        reply({ content: '{"passed": true, "note": "fact saved"}' }), // verification
        reply({ content: 'Noted.' }),
        (messages) => {
          secondTurnMessages = [...messages]
          return reply({ content: 'Avoiding peanuts then.' })
        },
      ],
      {
        embedder,
        tools: new ToolRegistry([makeSaveMemoryTool({ embedder, store, session })]),
      },
    )

    await runTurn(agent, 'remember that I am allergic to peanuts')

    // empty library on turn 1: recall was skipped, only the save embedded
    expect(embedded).toEqual([FACT])
    expect(store.listFacts().map((f) => f.content)).toEqual([FACT])
    expect(store.listFacts()[0]?.sessionId).toBe(session.id)
    // read-risk: executed with no permission prompt
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)

    await runTurn(agent, 'what should I eat for lunch?')

    const system = secondTurnMessages?.[0]?.content ?? ''
    expect(system).toContain('## Relevant Long-term Memories')
    expect(system).toContain(`- ${FACT}`)
    // recall embedded exactly the second turn's user message
    expect(embedded).toEqual([FACT, 'what should I eat for lunch?'])
  })

  it('degrades to a recall-free turn when the embedding backend fails mid-recall', async () => {
    const { store, session } = makeStore()
    store.insertFact({
      id: ulid(),
      content: 'The user is allergic to peanuts.',
      embedding: encodeFloat32([1, 0]),
      sessionId: session.id,
    })
    const embedder = fakeEmbedder(() => {
      throw new Error('embed backend down')
    })
    let secondTurnMessages: ChatMessage[] | undefined
    const { agent, events } = makeMemoryAgent(store, session, [
      reply({ content: 'first answer' }),
      (messages) => {
        secondTurnMessages = [...messages]
        return reply({ content: 'still answering' })
      },
    ], { embedder })

    await runTurn(agent, 'first question')
    await runTurn(agent, 'what should I eat for lunch?')

    // both turns completed normally, just without the recall block: the
    // system message is followed by the verbatim window and the new user message
    expect(secondTurnMessages?.[0]?.content ?? '').not.toContain('## Relevant Long-term Memories')
    expect(secondTurnMessages?.slice(1).map((m) => m.content)).toEqual([
      'first question',
      'first answer',
      'what should I eat for lunch?',
    ])
    expect(events.filter((e) => e.type === 'turn_failed')).toHaveLength(0)
  })

  it('a memory agent without an embedder keeps Layer 3 fully disabled', async () => {
    const { store, session } = makeStore()
    // an embedded fact exists, but with no embedder configured nothing is
    // recalled (no keyword fallback ever touches the store)
    store.insertFact({
      id: ulid(),
      content: 'The user is allergic to peanuts.',
      embedding: encodeFloat32([1, 0]),
      sessionId: session.id,
    })
    let turnMessages: ChatMessage[] | undefined
    // mirrors the index.ts wiring when LUME_EMBED_MODEL is unset
    const tools = new ToolRegistry([makeUpdateWorkingMemoryTool({ store, session })])
    const { agent } = makeMemoryAgent(store, session, [
      (messages) => {
        turnMessages = [...messages]
        return reply({ content: 'answer' })
      },
    ], { tools })

    expect(tools.getSchemas().map((s) => s.function.name)).not.toContain('save_memory')

    await runTurn(agent, 'what should I eat for lunch?')

    expect(turnMessages?.[0]?.content ?? '').not.toContain('## Relevant Long-term Memories')
  })
})

/* ------------------------------------------------- buildTurnContext wiring */

describe('buildTurnContext semanticRecall', () => {
  it('injects the given recall lines into the system message', () => {
    const { store, session } = makeStore()
    const history = buildTurnContext(
      store,
      session.id,
      { contextK: 30 },
      [],
      '- The user is allergic to peanuts.',
    )
    const system = history[0]?.content ?? ''
    expect(system).toContain('## Relevant Long-term Memories')
    expect(system).toContain('- The user is allergic to peanuts.')
  })
})
