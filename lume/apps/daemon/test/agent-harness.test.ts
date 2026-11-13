import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OutboundEvent } from '@lume/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { PermissionPolicy } from '../src/core/permission.js'
import { FakeProvider } from '../src/providers/fake.js'
import type { AssistantReply } from '../src/providers/types.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { createLogger } from '../src/util/logger.js'

const logger = createLogger('error')

function makeConfig(overrides: Record<string, unknown> = {}) {
  return ConfigSchema.parse({
    apiBaseUrl: 'http://localhost:1/v1',
    model: 'test-model',
    cwd: '/tmp',
    ...overrides,
  })
}

/** Capturing frontend; mirrors the skins: emits permission_request then resolves. */
function makeFrontend(permissionAnswers: boolean[] = []) {
  const events: OutboundEvent[] = []
  const answers = [...permissionAnswers]
  const frontend: Frontend = {
    emit: (e) => events.push(e),
    requestPermission: async (req) => {
      events.push({
        type: 'permission_request',
        turn_id: req.turnId,
        id: req.id,
        call_id: req.callId,
        tool: req.tool,
        args: req.args,
        reason: req.reason,
      })
      return answers.shift() ?? false
    },
  }
  return { frontend, events }
}

function toolCall(id: string, name: string, args: unknown): AssistantReply['toolCalls'] {
  return [{ id, name, arguments: JSON.stringify(args) }]
}

function reply(partial: Partial<AssistantReply>): AssistantReply {
  return { content: '', reasoning: '', toolCalls: [], finishReason: 'stop', ...partial }
}

function types(seq: OutboundEvent[]): string[] {
  return seq.map((e) => e.type)
}

async function runAgent(
  replies: AssistantReply[],
  opts: { permissions?: boolean[]; config?: Record<string, unknown>; cwd?: string } = {},
) {
  const provider = new FakeProvider(replies)
  const { frontend, events } = makeFrontend(opts.permissions ?? [])
  const agent = new Agent({
    provider,
    tools: new ToolRegistry(),
    policy: new PermissionPolicy(),
    config: makeConfig({ cwd: opts.cwd ?? '/tmp', ...opts.config }),
    logger,
  })
  agent.attachFrontend(frontend)
  const done = new Promise<void>((resolve) => {
    const check = () => {
      if (!agent.isBusy) resolve()
      else setTimeout(check, 10)
    }
    setTimeout(check, 10)
  })
  agent.submit('hello')
  await done
  return { events, provider }
}

describe('Agent + Harness micro cycle', () => {
  it('completes a plain turn without tools', async () => {
    const { events } = await runAgent([reply({ content: 'hi there' })])
    expect(types(events)).toEqual([
      'turn_started',
      'assistant_message_started',
      'assistant_delta',
      'assistant_message_completed',
      'turn_completed',
    ])
    expect(events.at(-1)).toMatchObject({ type: 'turn_completed', final_text: 'hi there' })
  })

  it('runs think->review->permission->act->verify for an approved tool call', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-agent-'))
    const { events } = await runAgent(
      [
        reply({ content: 'checking', toolCalls: toolCall('c1', 'bash', { command: 'echo ok' }) }),
        reply({ content: '{"passed": true, "note": "exit 0"}' }), // verification
        reply({ content: 'all done' }), // final answer
      ],
      { permissions: [true], cwd },
    )
    expect(types(events)).toEqual([
      'turn_started',
      'assistant_message_started',
      'assistant_delta',
      'assistant_message_completed',
      'tool_call_requested',
      'review_started',
      'review_completed',
      'permission_request',
      'tool_started',
      'tool_completed',
      'verification_started',
      'verification_completed',
      'assistant_message_started',
      'assistant_delta',
      'assistant_message_completed',
      'turn_completed',
    ])
    const toolCompleted = events.find((e) => e.type === 'tool_completed')
    expect(toolCompleted).toMatchObject({ type: 'tool_completed' })
    if (toolCompleted?.type === 'tool_completed') {
      expect(toolCompleted.result).toContain('ok')
    }
  })

  it('denied permission yields permission_denied and the model adapts', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-agent-'))
    const { events } = await runAgent(
      [
        reply({ toolCalls: toolCall('c1', 'bash', { command: 'echo ok' }) }),
        reply({ content: '{"passed": true}' }), // verification of the denial message
        reply({ content: 'okay, skipped' }),
      ],
      { permissions: [false], cwd },
    )
    const failed = events.find((e) => e.type === 'tool_failed')
    expect(failed).toMatchObject({
      type: 'tool_failed',
      error: { code: 'permission_denied' },
    })
    // verification of the tool message still runs and the turn completes
    expect(events.at(-1)).toMatchObject({ type: 'turn_completed' })
  })

  it('safety review blocks dangerous commands before permission', async () => {
    const requestPermission = vi.fn(async () => true)
    const provider = new FakeProvider([
      reply({ toolCalls: toolCall('c1', 'bash', { command: 'sudo rm file' }) }),
      reply({ content: '{"passed": true}' }),
      reply({ content: 'blocked anyway' }),
    ])
    const events: OutboundEvent[] = []
    const frontend: Frontend = {
      emit: (e) => events.push(e),
      requestPermission,
    }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig(),
      logger,
    })
    agent.attachFrontend(frontend)
    const done = new Promise<void>((resolve) => {
      const check = () => (agent.isBusy ? setTimeout(check, 10) : resolve())
      setTimeout(check, 10)
    })
    agent.submit('do it')
    await done

    expect(requestPermission).not.toHaveBeenCalled()
    const failed = events.find((e) => e.type === 'tool_failed')
    expect(failed).toMatchObject({ type: 'tool_failed', error: { code: 'safety_blocked' } })
    expect(events.at(-1)).toMatchObject({ type: 'turn_completed' })
  })

  it('failed verification feeds back a corrective message', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-agent-'))
    const provider = new FakeProvider([
      reply({ toolCalls: toolCall('c1', 'bash', { command: 'echo ok' }) }),
      reply({ content: '{"passed": false, "note": "output missing"}' }), // verification fails
      reply({ content: 'retrying' }), // model sees feedback and answers
    ])
    const events: OutboundEvent[] = []
    const frontend: Frontend = {
      emit: (e) => events.push(e),
      requestPermission: async () => true,
    }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig({ cwd }),
      logger,
    })
    agent.attachFrontend(frontend)
    const done = new Promise<void>((resolve) => {
      const check = () => (agent.isBusy ? setTimeout(check, 10) : resolve())
      setTimeout(check, 10)
    })
    agent.submit('go')
    await done

    const verify = events.find((e) => e.type === 'verification_completed')
    expect(verify).toMatchObject({ type: 'verification_completed', passed: false })
    // corrective feedback message was queued into the provider messages
    const lastCall = (provider as unknown as { script: unknown[] }).script
    expect(lastCall).toBeDefined()
    expect(events.at(-1)).toMatchObject({ type: 'turn_completed', final_text: 'retrying' })
  })

  it('queues user messages while busy', async () => {
    const provider = new FakeProvider([
      reply({ content: 'first answer' }),
      reply({ content: 'second answer' }),
    ])
    const events: OutboundEvent[] = []
    const frontend: Frontend = { emit: (e) => events.push(e), requestPermission: async () => false }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig(),
      logger,
    })
    agent.attachFrontend(frontend)

    const idle = new Promise<void>((resolve) => {
      const check = () => (agent.isBusy ? setTimeout(check, 5) : resolve())
      setTimeout(check, 5)
    })
    agent.submit('first')
    agent.submit('second') // queued while first is in flight
    await idle
    // let the queue pump
    await new Promise((r) => setTimeout(r, 100))

    expect(events.filter((e) => e.type === 'user_message_queued')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'turn_completed')).toHaveLength(2)
  })

  it('interrupt aborts the in-flight turn', async () => {
    const provider = new FakeProvider([])
    // provider that never yields: block on first call via a deferred script entry
    const events: OutboundEvent[] = []
    const frontend: Frontend = { emit: (e) => events.push(e), requestPermission: async () => false }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig(),
      logger,
    })
    agent.attachFrontend(frontend)

    // a provider whose stream only ends when aborted
    const hangingProvider = {
      name: 'hanging',
      async *chat(options: { signal?: AbortSignal }) {
        yield { type: 'text_delta', delta: 'partial' } as const
        await new Promise<void>((resolve, reject) => {
          const signal = options.signal
          if (signal === undefined) {
            reject(new Error('no signal'))
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        throw new Error('aborted mid-stream')
      },
    }
    const hangingAgent = new Agent({
      provider: hangingProvider as never,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig(),
      logger,
    })
    hangingAgent.attachFrontend(frontend)

    const settle = new Promise<void>((resolve) => {
      const check = () => (hangingAgent.isBusy ? setTimeout(check, 5) : resolve())
      setTimeout(check, 5)
    })
    hangingAgent.submit('hang')
    await new Promise((r) => setTimeout(r, 30))
    hangingAgent.interrupt()
    await settle

    const failed = events.find((e) => e.type === 'turn_failed')
    expect(failed).toMatchObject({ type: 'turn_failed', reason: 'aborted' })
  })

  it('enforces the tool-loop guard by forcing a final answer', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-agent-'))
    const loopReply = () =>
      reply({ toolCalls: toolCall(`c${Math.random()}`, 'bash', { command: 'echo loop' }) })
    const verifyReply = () => reply({ content: '{"passed": true}' })
    const replies: AssistantReply[] = []
    for (let i = 0; i < 3; i++) replies.push(loopReply(), verifyReply())
    // after the guard kicks in, the forced final call (no tools) answers:
    replies.push(reply({ content: 'forced final answer' }))

    const provider = new FakeProvider(replies)
    const events: OutboundEvent[] = []
    const frontend: Frontend = { emit: (e) => events.push(e), requestPermission: async () => true }
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig({ maxToolLoopsPerTurn: 3, cwd }),
      logger,
    })
    agent.attachFrontend(frontend)

    const done = new Promise<void>((resolve) => {
      const check = () => (agent.isBusy ? setTimeout(check, 10) : resolve())
      setTimeout(check, 10)
    })
    agent.submit('loop forever')
    await done

    const completes = events.filter((e) => e.type === 'turn_completed')
    expect(completes).toHaveLength(1)
    expect(completes[0]).toMatchObject({ final_text: 'forced final answer' })
  })
})
