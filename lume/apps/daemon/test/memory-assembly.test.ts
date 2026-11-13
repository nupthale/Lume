import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { memoryPromptSections } from '../src/core/prompts.js'
import { PermissionPolicy } from '../src/core/permission.js'
import { buildTurnContext } from '../src/memory/context.js'
import { type PersistableChatMessage, toChatMessage, toStoredMessage } from '../src/memory/mapping.js'
import type { MessageRole, MessageRow, SessionRow } from '../src/memory/store.js'
import { SqliteStore } from '../src/memory/store.js'
import { type FakeReply, FakeProvider } from '../src/providers/fake.js'
import type { AssistantReply, ChatMessage } from '../src/providers/types.js'
import { ToolRegistry } from '../src/tools/registry.js'
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

/** MessageRow with overridable fields; toolCalls passed through as stored text */
function messageRow(overrides: Partial<MessageRow> & { role: MessageRole }): MessageRow {
  return {
    sessionId: 's',
    seq: 1,
    content: 'x',
    toolCalls: null,
    toolCallId: null,
    name: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lume-memory-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('message mapping', () => {
  it('round-trips user/assistant(tool_calls)/tool messages through the store', () => {
    const { store, session } = makeStore()
    const originals: PersistableChatMessage[] = [
      { role: 'user', content: 'list the files' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'bash', arguments: '{"command":"ls"}' }],
      },
      { role: 'tool', content: 'file-a\nfile-b', toolCallId: 'c1', name: 'bash' },
      { role: 'assistant', content: 'done' },
    ]
    for (const msg of originals) {
      store.appendMessage(toStoredMessage(session.id, msg))
    }

    const restored = store.getMessages(session.id).map(toChatMessage)
    expect(restored).toEqual(originals)
    expect(store.getMessages(session.id).map((r) => r.seq)).toEqual([1, 2, 3, 4])
  })

  it('degrades corrupted tool_calls JSON to a plain assistant message', () => {
    expect(toChatMessage(messageRow({ role: 'assistant', toolCalls: '{not json' }))).toEqual({
      role: 'assistant',
      content: 'x',
    })
    // valid JSON that is not an array degrades the same way
    expect(toChatMessage(messageRow({ role: 'assistant', toolCalls: '"just a string"' }))).toEqual({
      role: 'assistant',
      content: 'x',
    })
  })

  it('throws on a stored role outside user/assistant/tool', () => {
    const row = messageRow({ role: 'system' as unknown as MessageRole })
    expect(() => toChatMessage(row)).toThrow(/unexpected stored message role/)
  })
})

describe('memoryPromptSections', () => {
  it('renders nothing when all inputs are empty', () => {
    expect(memoryPromptSections({ workingMemory: '', summary: '', semanticRecall: '' })).toBe('')
  })

  it('renders only the non-empty sections in order', () => {
    expect(memoryPromptSections({ workingMemory: '', summary: 'only summary', semanticRecall: '' })).toBe(
      '\n## Conversation So Far (rolling summary)\nonly summary\n',
    )

    const out = memoryPromptSections({
      workingMemory: '{"name":"hale"}',
      summary: 'User asked about files.',
      semanticRecall: 'Allergic to peanuts.',
    })
    const profile = out.indexOf('## User Profile (maintained by update_working_memory)')
    const summary = out.indexOf('## Conversation So Far (rolling summary)')
    const recall = out.indexOf('## Relevant Long-term Memories')
    expect(profile).toBeGreaterThanOrEqual(0)
    expect(summary).toBeGreaterThan(profile)
    expect(recall).toBeGreaterThan(summary)
    expect(out).toContain('{"name":"hale"}')
    expect(out).toContain('User asked about files.')
    expect(out).toContain('Allergic to peanuts.')
  })
})

describe('buildTurnContext', () => {
  it('composes the system message from prompt, skills and memory sections', () => {
    const { store, session } = makeStore()
    store.updateSession(session.id, { workingMemory: '{"name":"hale"}' })

    const history = buildTurnContext(
      store,
      session.id,
      { contextK: 30 },
      [{ name: 'my-skill', description: 'does things' }],
    )

    expect(history).toHaveLength(1) // fresh session: no messages yet
    const system = history[0]?.role === 'system' ? history[0].content : ''
    expect(system).toContain('You are lume')
    const skills = system.indexOf('Skills available in this workspace')
    const profile = system.indexOf('## User Profile (maintained by update_working_memory)')
    expect(skills).toBeGreaterThan(0)
    expect(profile).toBeGreaterThan(skills)
    expect(system).toContain('{"name":"hale"}')
    expect(system).not.toContain('## Conversation So Far')
    expect(system).not.toContain('## Relevant Long-term Memories')
  })

  it('keeps the verbatim window strictly above the watermark', () => {
    const { store, session } = makeStore()
    const contents = ['u1', 'a2', 'u3', 'a4', 'u5', 'a6']
    for (const content of contents) {
      store.appendMessage({
        sessionId: session.id,
        role: content.startsWith('u') ? 'user' : 'assistant',
        content,
      })
    }
    // simulate the Task 4 compressor having summarized seq 1..3
    store.updateSession(session.id, { summarizedUntilSeq: 3, summary: 'sum of u1..a3' })

    const history = buildTurnContext(store, session.id, { contextK: 30 }, [])
    expect(history[0]?.role).toBe('system')
    expect(history[0]?.content).toContain('## Conversation So Far (rolling summary)')
    expect(history.slice(1)).toEqual([
      { role: 'assistant', content: 'a4' },
      { role: 'user', content: 'u5' },
      { role: 'assistant', content: 'a6' },
    ])

    // contextK keeps the newest K of the above-water messages, in order
    const limited = buildTurnContext(store, session.id, { contextK: 2 }, [])
    expect(limited.slice(1)).toEqual([
      { role: 'user', content: 'u5' },
      { role: 'assistant', content: 'a6' },
    ])
  })
})

describe('Agent memory mode (end to end)', () => {
  interface AgentOpts {
    permissions?: boolean[]
    config?: Record<string, unknown>
  }

  /** Memory-mode agent wired to the given store; mirrors the agent-harness test rig */
  function makeMemoryAgent(
    store: SqliteStore,
    session: SessionRow,
    script: FakeReply[],
    opts: AgentOpts = {},
  ): Agent {
    const events: unknown[] = []
    const answers = [...(opts.permissions ?? [])]
    const frontend: Frontend = {
      emit: (e) => events.push(e),
      requestPermission: async () => answers.shift() ?? false,
    }
    const agent = new Agent({
      provider: new FakeProvider(script),
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig({ cwd: dir, ...opts.config }),
      logger,
      memory: { store, session },
    })
    agent.attachFrontend(frontend)
    return agent
  }

  async function runTurn(agent: Agent, content: string): Promise<void> {
    agent.submit(content)
    while (agent.isBusy) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  it('persists user/assistant(tool_calls)/tool messages in order over one turn', async () => {
    const { store, session } = makeStore()
    const agent = makeMemoryAgent(store, session, [
      reply({
        content: 'checking',
        toolCalls: [{ id: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'echo ok' }) }],
      }),
      reply({ content: '{"passed": true, "note": "exit 0"}' }), // verification
      reply({ content: 'all done' }),
    ], { permissions: [true] })

    await runTurn(agent, 'list the directory')

    const rows = store.getMessages(session.id)
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]) // seq is continuous
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(rows[0]?.content).toBe('list the directory')

    // assistant tool_calls persist as restorable JSON
    const toolCalls = JSON.parse(rows[1]?.toolCalls ?? 'null') as unknown
    expect(toolCalls).toEqual([{ id: 'c1', name: 'bash', arguments: '{"command":"echo ok"}' }])

    // tool message carries tool_call_id + name and the real tool output
    expect(rows[2]).toMatchObject({ role: 'tool', toolCallId: 'c1', name: 'bash' })
    expect(rows[2]?.content).toContain('ok')

    expect(rows[3]?.content).toBe('all done')

    // the stored row maps back to an equivalent ChatMessage
    expect(store.getMessages(session.id).map(toChatMessage)[1]).toEqual({
      role: 'assistant',
      content: 'checking',
      toolCalls: [{ id: 'c1', name: 'bash', arguments: '{"command":"echo ok"}' }],
    })
  })

  it('persists the verification-failure feedback as a user message', async () => {
    const { store, session } = makeStore()
    const agent = makeMemoryAgent(store, session, [
      reply({
        content: 'checking',
        toolCalls: [{ id: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'echo ok' }) }],
      }),
      reply({ content: '{"passed": false, "note": "output missing"}' }), // verification fails
      reply({ content: 'retrying' }),
    ], { permissions: [true] })

    await runTurn(agent, 'go')

    const rows = store.getMessages(session.id)
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant'])
    expect(rows[3]?.content).toContain('failed verification')
    expect(rows[4]?.content).toBe('retrying')
  })

  it('rebuilds the context from the store each turn and honors the watermark', async () => {
    const { store, session } = makeStore()
    let secondTurnMessages: ChatMessage[] | undefined
    const agent = makeMemoryAgent(store, session, [
      reply({ content: 'first answer' }),
      (messages) => {
        secondTurnMessages = [...messages]
        return reply({ content: 'second answer' })
      },
    ])

    await runTurn(agent, 'first question')

    // simulate the Task 4 compressor having fully summarized the first turn
    store.updateSession(session.id, {
      summary: 'The user asked a first question; it was answered.',
      summarizedUntilSeq: 2,
      workingMemory: '{"name":"hale"}',
    })

    await runTurn(agent, 'second question')

    // turn 2 provider view: rebuilt system (summary + profile, no verbatim
    // messages below the watermark) followed by the new user message only
    expect(secondTurnMessages?.map((m) => m.role)).toEqual(['system', 'user'])
    expect(secondTurnMessages?.[1]?.content).toBe('second question')
    const system = secondTurnMessages?.[0]?.content ?? ''
    expect(system).toContain('## Conversation So Far (rolling summary)')
    expect(system).toContain('The user asked a first question; it was answered.')
    expect(system).toContain('## User Profile (maintained by update_working_memory)')
    expect(system).not.toContain('first answer') // summarized content stays out of the window

    // the store keeps growing append-only; assembly never moves the watermark
    const rows = store.getMessages(session.id)
    expect(rows.map((r) => r.content)).toEqual([
      'first question',
      'first answer',
      'second question',
      'second answer',
    ])
    expect(store.getSession(session.id)?.summarizedUntilSeq).toBe(2)
  })

  it('caps the verbatim window at contextK on rebuild', async () => {
    const { store, session } = makeStore()
    let secondTurnMessages: ChatMessage[] | undefined
    const agent = makeMemoryAgent(
      store,
      session,
      [
        reply({ content: 'first answer' }),
        (messages) => {
          secondTurnMessages = [...messages]
          return reply({ content: 'second answer' })
        },
      ],
      { config: { contextK: 1 } },
    )

    await runTurn(agent, 'first question')
    await runTurn(agent, 'second question')

    // window keeps only the newest 1 message (first answer), then user is appended
    expect(secondTurnMessages?.map((m) => m.role)).toEqual(['system', 'assistant', 'user'])
    expect(secondTurnMessages?.[1]?.content).toBe('first answer')
    expect(secondTurnMessages?.[2]?.content).toBe('second question')
  })
})
