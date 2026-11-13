import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OutboundEvent } from '@lume/protocol'
import { z } from 'zod'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { envPromptSection } from '../src/core/prompts.js'
import { buildTurnContext, repairToolPairing } from '../src/memory/context.js'
import { type SessionRow, SqliteStore } from '../src/memory/store.js'
import { PermissionPolicy } from '../src/core/permission.js'
import { FakeProvider } from '../src/providers/fake.js'
import type { AssistantReply, ChatMessage, LlmProvider } from '../src/providers/types.js'
import { type ToolDefinition, type ToolResult } from '../src/tools/types.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { createLogger } from '../src/util/logger.js'
import { ulid } from '../src/util/ulid.js'

const logger = createLogger('error')

function makeConfig(cwd: string) {
  return ConfigSchema.parse({ apiBaseUrl: 'http://localhost:1/v1', model: 'test-model', cwd })
}

function makeStore(): { store: SqliteStore; session: SessionRow } {
  const store = new SqliteStore(':memory:')
  const session = store.createSession({ id: ulid(), cwd: '/tmp', model: 'test-model' })
  return { store, session }
}

describe('envPromptSection', () => {
  it('renders fresh time, OS and working directory', () => {
    const section = envPromptSection('/some/dir')
    expect(section).toContain('## Environment')
    expect(section).toContain('Current time:')
    expect(section).toContain('OS:')
    expect(section).toContain('/some/dir')
  })

  it('omits the working directory line when cwd is empty', () => {
    const section = envPromptSection('')
    expect(section).toContain('Current time:')
    expect(section).not.toContain('Working directory:')
  })
})

describe('buildTurnContext environment injection', () => {
  it('injects the environment section when cwd is provided', () => {
    const { store, session } = makeStore()
    const history = buildTurnContext(store, session.id, { contextK: 30 }, [], '', '/work/dir')
    expect(history[0]?.content).toContain('## Environment')
    expect(history[0]?.content).toContain('/work/dir')
  })

  it('keeps the default call signature working (no cwd line)', () => {
    const { store, session } = makeStore()
    const history = buildTurnContext(store, session.id, { contextK: 30 }, [])
    expect(history[0]?.content).toContain('## Environment')
    expect(history[0]?.content).not.toContain('Working directory:')
  })
})

/**
 * Provider that hangs on the first call until aborted, then answers normally
 * on later calls. Captures every request's messages for assertions.
 */
function makeHangProvider(): { provider: LlmProvider; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = []
  let n = 0
  const provider: LlmProvider = {
    name: 'hang',
    async *chat(opts) {
      calls.push(opts.messages)
      n += 1
      if (n === 1) {
        yield { type: 'text_delta', delta: 'partial ' }
        const signal = opts.signal
        if (signal === undefined) throw new Error('test provider: no abort signal')
        await new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('stream aborted'))
          })
        })
      }
      yield { type: 'text_delta', delta: `reply-${n}` }
      yield { type: 'done', finishReason: 'stop' }
    },
  }
  return { provider, calls }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(predicate()).toBe(true)
}

describe('repairToolPairing', () => {
  const call = (id: string, name = 'bash') => ({
    id,
    name,
    arguments: '{"command":"true"}',
  })

  it('injects synthetic tool results for unanswered tool calls', () => {
    const repaired = repairToolPairing([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [call('c1')] },
      { role: 'user', content: 'next' },
    ])
    expect(repaired[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: '(no result was produced for this tool call)',
    })
    expect(repaired[3]).toEqual({ role: 'user', content: 'next' })
  })

  it('keeps answered calls untouched and is idempotent', () => {
    const valid: ChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [call('c1')] },
      { role: 'tool', content: 'ok', toolCallId: 'c1', name: 'bash' },
      { role: 'assistant', content: 'done' },
    ]
    expect(repairToolPairing(valid)).toEqual(valid)
    expect(repairToolPairing(repairToolPairing(valid))).toEqual(valid)
  })

  it('drops orphan tool messages whose assistant was trimmed out', () => {
    const repaired = repairToolPairing([
      { role: 'tool', content: 'leftover', toolCallId: 'gone', name: 'bash' },
      { role: 'user', content: 'hi' },
    ])
    expect(repaired).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('assembly repairs a corrupted session window end to end', () => {
    const { store, session } = makeStore()
    store.appendMessage({ sessionId: session.id, role: 'user', content: 'go' })
    store.appendMessage({
      sessionId: session.id,
      role: 'assistant',
      content: '',
      toolCalls: [call('c1')],
    })
    store.appendMessage({ sessionId: session.id, role: 'user', content: 'again' })
    const history = buildTurnContext(store, session.id, { contextK: 30 }, [])
    expect(history.slice(1)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [call('c1')] },
      {
        role: 'tool',
        content: '(no result was produced for this tool call)',
        toolCallId: 'c1',
        name: 'bash',
      },
      { role: 'user', content: 'again' },
    ])
  })
})

describe('aborted turn closes the dangling user message', () => {
  it('persists a placeholder assistant message (memory mode)', async () => {
    const { store, session } = makeStore()
    const { provider, calls } = makeHangProvider()
    const events: OutboundEvent[] = []
    const frontend: Frontend = { emit: (e) => events.push(e), requestPermission: async () => false }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig('/tmp'),
      logger,
      memory: { store, session },
    })
    agent.attachFrontend(frontend)

    agent.submit('hello')
    await waitFor(() => calls.length === 1)
    agent.interrupt()
    await waitFor(() => !agent.isBusy)

    // the aborted turn ends with a placeholder assistant, not a dangling user
    const rows = store.getMessages(session.id)
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ['user', 'hello'],
      ['assistant', '(turn aborted by user)'],
    ])
    expect(events.some((e) => e.type === 'turn_failed' && e.error?.code === 'aborted')).toBe(true)

    // the next turn's assembled window carries the closed pair + env section
    agent.submit('again')
    await waitFor(() => calls.length === 2)
    await waitFor(() => !agent.isBusy)

    const window = calls[1]
    expect(window.slice(0, 1)[0]?.role).toBe('system')
    expect(window[0]?.content).toContain('## Environment')
    expect(window.slice(1)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '(turn aborted by user)' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'reply-2' },
    ])
  })

  it('closes the pair in plain (no-memory) mode too', async () => {
    const { provider, calls } = makeHangProvider()
    const events: OutboundEvent[] = []
    const frontend: Frontend = { emit: (e) => events.push(e), requestPermission: async () => false }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig('/tmp'),
      logger,
    })
    agent.attachFrontend(frontend)

    agent.submit('hello')
    await waitFor(() => calls.length === 1)
    agent.interrupt()
    await waitFor(() => !agent.isBusy)

    agent.submit('again')
    await waitFor(() => calls.length === 2)
    await waitFor(() => !agent.isBusy)

    const window = calls[1]
    expect(window[0]?.role).toBe('system')
    expect(window[0]?.content).toContain('## Environment')
    expect(window.slice(1)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '(turn aborted by user)' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'reply-2' },
    ])
  })

  it('aborted mid-tool-cycle: persists synthetic tool result + closes the pair', async () => {
    const { store, session } = makeStore()
    const slowTool: ToolDefinition = {
      name: 'slow_tool',
      description: 'hangs until aborted',
      risk: 'read',
      parameters: { type: 'object', properties: {} },
      argsSchema: z.object({}),
      timeoutMs: 60_000,
      async execute(_args, ctx): Promise<ToolResult> {
        await new Promise<never>((_, reject) => {
          ctx.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
        throw new Error('unreachable: the promise above never resolves')
      },
    }
    let secondWindow: ChatMessage[] | undefined
    const provider = new FakeProvider([
      {
        content: 'checking',
        toolCalls: [{ id: 't1', name: 'slow_tool', arguments: '{}' }],
        reasoning: '',
        finishReason: 'tool_calls',
      },
      (messages) => {
        secondWindow = [...messages]
        return { content: 'reply-2', reasoning: '', toolCalls: [], finishReason: 'stop' }
      },
    ])
    const events: OutboundEvent[] = []
    const frontend: Frontend = { emit: (e) => events.push(e), requestPermission: async () => false }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry([slowTool]),
      policy: new PermissionPolicy(),
      config: makeConfig('/tmp'),
      logger,
      memory: { store, session },
    })
    agent.attachFrontend(frontend)

    agent.submit('hello')
    await waitFor(() => events.some((e) => e.type === 'tool_started'))
    agent.interrupt()
    await waitFor(() => !agent.isBusy)
    expect(events.some((e) => e.type === 'turn_failed' && e.error?.code === 'aborted')).toBe(true)

    // transcript repair: unanswered tool call got a synthetic result, and the
    // dangling user message got an assistant placeholder
    const rows = store.getMessages(session.id)
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'checking'],
      ['tool', '(tool call was interrupted; no result was produced)'],
      ['assistant', '(turn aborted by user)'],
    ])
    const storedCall = JSON.parse(rows[1]?.toolCalls ?? '[]') as Array<{ id: string; name: string }>
    expect(storedCall).toEqual([{ id: 't1', name: 'slow_tool', arguments: '{}' }])

    // the tool placeholder row carries the call id
    expect(rows[2]?.toolCallId).toBe('t1')

    // next turn's window is protocol-valid: assistant(tool_calls) -> tool -> assistant
    agent.submit('again')
    await waitFor(() => secondWindow !== undefined && !agent.isBusy)
    expect(secondWindow?.slice(1)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'checking', toolCalls: [{ id: 't1', name: 'slow_tool', arguments: '{}' }] },
      { role: 'tool', content: '(tool call was interrupted; no result was produced)', toolCallId: 't1', name: 'slow_tool' },
      { role: 'assistant', content: '(turn aborted by user)' },
      { role: 'user', content: 'again' },
    ])
  })
})
