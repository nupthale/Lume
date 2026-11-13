import type { OutboundEvent } from '@lume/protocol'
import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { PermissionPolicy } from '../src/core/permission.js'
import { type SessionRow, SqliteStore } from '../src/memory/store.js'
import {
  WORKING_MEMORY_MAX_CHARS,
  makeUpdateWorkingMemoryTool,
} from '../src/memory/working-memory-tool.js'
import { type FakeReply, FakeProvider } from '../src/providers/fake.js'
import type { AssistantReply, ChatMessage } from '../src/providers/types.js'
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

function toolCtx() {
  return { cwd: '/tmp', signal: new AbortController().signal, maxOutputChars: 2000 }
}

describe('update_working_memory (tool)', () => {
  it('overwrites the stored profile, syncs the session cache and reports the new length', async () => {
    const { store, session } = makeStore()
    const registry = new ToolRegistry([makeUpdateWorkingMemoryTool({ store, session })])
    const content = '{"name":"hale","prefers":"concise answers"}'

    const result = await registry.execute('update_working_memory', { content }, toolCtx())

    expect(store.getSession(session.id)?.workingMemory).toBe(content)
    expect(session.workingMemory).toBe(content) // in-memory cache stays in sync
    expect(result.output).toContain(`(${content.length} chars)`)
  })

  it('accepts content exactly at the cap', async () => {
    const { store, session } = makeStore()
    const registry = new ToolRegistry([makeUpdateWorkingMemoryTool({ store, session })])
    const content = 'x'.repeat(WORKING_MEMORY_MAX_CHARS)

    const result = await registry.execute('update_working_memory', { content }, toolCtx())

    expect(store.getSession(session.id)?.workingMemory).toBe(content)
    expect(result.output).toContain(`(${WORKING_MEMORY_MAX_CHARS} chars)`)
  })

  it('rejects oversized content without touching the stored value', async () => {
    const { store, session } = makeStore()
    // seed both the store and the session cache the way the tool keeps them in sync
    store.updateSession(session.id, { workingMemory: 'original profile' })
    session.workingMemory = 'original profile'
    const registry = new ToolRegistry([makeUpdateWorkingMemoryTool({ store, session })])
    const oversized = 'y'.repeat(WORKING_MEMORY_MAX_CHARS + 1)

    await expect(
      registry.execute('update_working_memory', { content: oversized }, toolCtx()),
    ).rejects.toThrow(ToolError)
    await expect(
      registry.execute('update_working_memory', { content: oversized }, toolCtx()),
    ).rejects.toThrow(
      new RegExp(
        `must stay under ${WORKING_MEMORY_MAX_CHARS} characters \\(got ${oversized.length}\\)\\. Rewrite it more compactly\\.`,
      ),
    )

    expect(store.getSession(session.id)?.workingMemory).toBe('original profile')
    expect(session.workingMemory).toBe('original profile')
  })
})

describe('update_working_memory (permission)', () => {
  it('is read-risk and therefore auto-approved by the policy', () => {
    const { store, session } = makeStore()
    const tool = makeUpdateWorkingMemoryTool({ store, session })
    expect(tool.risk).toBe('read')
    expect(new PermissionPolicy().requiresApproval(tool.name, tool.risk)).toBe(false)
  })
})

describe('update_working_memory (agent integration)', () => {
  /** memory-mode agent wired to the given store; mirrors the memory-assembly test rig */
  function makeMemoryAgent(
    store: SqliteStore,
    session: SessionRow,
    script: FakeReply[],
  ): { agent: Agent; events: OutboundEvent[]; permissionAsks: () => number } {
    const events: OutboundEvent[] = []
    let permissionAsks = 0
    const frontend: Frontend = {
      emit: (e) => events.push(e),
      requestPermission: async () => {
        permissionAsks++
        return false
      },
    }
    const agent = new Agent({
      provider: new FakeProvider(script),
      tools: new ToolRegistry([makeUpdateWorkingMemoryTool({ store, session })]),
      policy: new PermissionPolicy(),
      config: makeConfig(),
      logger,
      memory: { store, session },
    })
    agent.attachFrontend(frontend)
    return { agent, events, permissionAsks: () => permissionAsks }
  }

  async function runTurn(agent: Agent, content: string): Promise<void> {
    agent.submit(content)
    while (agent.isBusy) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  it('persists a model-driven update and injects it into the next turn without a permission prompt', async () => {
    const { store, session } = makeStore()
    const profile = '{"name":"hale","prefers":"concise answers"}'
    let secondTurnMessages: ChatMessage[] | undefined
    const { agent, events, permissionAsks } = makeMemoryAgent(store, session, [
      reply({
        content: 'Saving your profile.',
        toolCalls: [
          {
            id: 'wm1',
            name: 'update_working_memory',
            arguments: JSON.stringify({ content: profile }),
          },
        ],
        finishReason: 'tool_calls',
      }),
      reply({ content: '{"passed": true, "note": "profile saved"}' }), // verification
      reply({ content: 'Saved your profile.' }),
      (messages) => {
        secondTurnMessages = [...messages]
        return reply({ content: 'second answer' })
      },
    ])

    await runTurn(agent, 'remember that I prefer concise answers')
    await runTurn(agent, 'what do you remember about me?')

    // the model's overwrite landed in the store
    expect(store.getSession(session.id)?.workingMemory).toBe(profile)

    // read-risk: the call executed with no permission prompt and a length report
    expect(permissionAsks()).toBe(0)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    const completed = events.filter((e) => e.type === 'tool_completed')
    expect(completed).toHaveLength(1)
    if (completed[0]?.type === 'tool_completed') {
      expect(completed[0].result).toContain(`(${profile.length} chars)`)
    }

    // next turn: the system message carries the User Profile section with the new content
    expect(secondTurnMessages?.[0]?.role).toBe('system')
    const system = secondTurnMessages?.[0]?.content ?? ''
    expect(system).toContain('## User Profile (maintained by update_working_memory)')
    expect(system).toContain(profile)
  })
})
