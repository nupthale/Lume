import type { OutboundEvent } from '@lume/protocol'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { todosPromptSection } from '../src/core/prompts.js'
import { PermissionPolicy } from '../src/core/permission.js'
import { type SessionRow, SqliteStore } from '../src/memory/store.js'
import { TODO_MAX_ITEMS, makeTodoWriteTool } from '../src/memory/todo-write-tool.js'
import { FakeProvider, type FakeReply } from '../src/providers/fake.js'
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

describe('SqliteStore todos', () => {
  it('replaceTodos overwrites the whole list and returns the fresh rows', () => {
    const { store, session } = makeStore()
    const first = store.replaceTodos(
      [
        { content: 'first task', status: 'pending' },
        { content: 'second task', status: 'in_progress' },
      ],
      session.id,
    )
    expect(store.listTodos().map((t) => t.content)).toEqual(['second task', 'first task'])

    const second = store.replaceTodos([{ content: 'only task', status: 'pending' }], session.id)
    const listed = store.listTodos()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.content).toBe('only task')
    // old rows are gone, not merged: fresh ids, never reused
    expect(first.map((t) => t.id)).not.toContain(listed[0]?.id)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ content: 'only task', status: 'pending' })
    expect(second[0]?.originSessionId).toBe(session.id)
    // timestamps are ISO strings
    expect(new Date(second[0]?.createdAt ?? '').toISOString()).toBe(second[0]?.createdAt)
    expect(second[0]?.updatedAt).toBe(second[0]?.createdAt)
  })

  it('replaceTodos with an empty array clears the list', () => {
    const { store, session } = makeStore()
    store.replaceTodos([{ content: 'will be cleared', status: 'pending' }], session.id)
    expect(store.listTodos()).toHaveLength(1)

    const rows = store.replaceTodos([], session.id)
    expect(rows).toEqual([])
    expect(store.listTodos()).toEqual([])
  })

  it('listTodos orders in_progress before pending before completed, insertion order within a group', () => {
    const { store, session } = makeStore()
    store.replaceTodos(
      [
        { content: 'done earlier', status: 'completed' },
        { content: 'waiting', status: 'pending' },
        { content: 'active now', status: 'in_progress' },
        { content: 'waiting more', status: 'pending' },
        { content: 'done later', status: 'completed' },
      ],
      session.id,
    )

    expect(store.listTodos().map((t) => t.content)).toEqual([
      'active now',
      'waiting',
      'waiting more',
      'done earlier',
      'done later',
    ])
  })

  it('todos persist across store restarts and record the origin session', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lume-todos-'))
    const dbPath = path.join(dir, 'lume.db')
    const first = new SqliteStore(dbPath)
    first.createSession({ id: 'origin-session', cwd: '/tmp', model: 'm' })
    first.replaceTodos([{ content: 'survives restart', status: 'in_progress' }], 'origin-session')
    first.close()

    const reopened = new SqliteStore(dbPath)
    const todos = reopened.listTodos()
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({
      content: 'survives restart',
      status: 'in_progress',
      originSessionId: 'origin-session',
    })
    reopened.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('todosPromptSection', () => {
  it('renders nothing for an empty list', () => {
    expect(todosPromptSection([])).toBe('')
  })

  it('renders the heading and one line per todo in the given order', () => {
    const rows = [
      {
        id: ulid(),
        content: 'fix the bug',
        status: 'in_progress' as const,
        originSessionId: 's',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: ulid(),
        content: 'write tests',
        status: 'pending' as const,
        originSessionId: 's',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]
    const out = todosPromptSection(rows)
    expect(out).toBe(
      '\n## Task List (maintained by todo_write; overwrite semantics — always send the full updated list)\n' +
        '- [in_progress] fix the bug\n' +
        '- [pending] write tests\n',
    )
  })
})

describe('todo_write (tool)', () => {
  it('overwrites the stored list and renders it in the tool output', async () => {
    const { store, session } = makeStore()
    const registry = new ToolRegistry([makeTodoWriteTool({ store, session })])

    const first = await registry.execute(
      'todo_write',
      { todos: [{ content: 'seed item', status: 'pending' }] },
      toolCtx(),
    )
    expect(first.output).toContain('- [pending] seed item')
    expect(first.output).toContain('## Task List')

    const second = await registry.execute(
      'todo_write',
      { todos: [{ content: 'new item', status: 'in_progress' }] },
      toolCtx(),
    )
    expect(second.output).toContain('- [in_progress] new item')
    expect(store.listTodos().map((t) => t.content)).toEqual(['new item'])
  })

  it('clears the list with an empty array and reports it', async () => {
    const { store, session } = makeStore()
    const registry = new ToolRegistry([makeTodoWriteTool({ store, session })])
    await registry.execute(
      'todo_write',
      { todos: [{ content: 'temp', status: 'completed' }] },
      toolCtx(),
    )

    const result = await registry.execute('todo_write', { todos: [] }, toolCtx())
    expect(result.output).toBe('task list cleared (0 todos)')
    expect(store.listTodos()).toEqual([])
  })

  it('rejects more than 50 items without touching the stored list', async () => {
    const { store, session } = makeStore()
    store.replaceTodos([{ content: 'keep me', status: 'pending' }], session.id)
    const registry = new ToolRegistry([makeTodoWriteTool({ store, session })])
    const tooMany = Array.from({ length: TODO_MAX_ITEMS + 1 }, (_, i) => ({
      content: `item ${i}`,
      status: 'pending' as const,
    }))

    await expect(registry.execute('todo_write', { todos: tooMany }, toolCtx())).rejects.toThrow(
      ToolError,
    )
    expect(store.listTodos().map((t) => t.content)).toEqual(['keep me'])
  })

  it('accepts exactly 50 items', async () => {
    const { store, session } = makeStore()
    const registry = new ToolRegistry([makeTodoWriteTool({ store, session })])
    const fifty = Array.from({ length: TODO_MAX_ITEMS }, (_, i) => ({
      content: `item ${i}`,
      status: 'pending' as const,
    }))

    const result = await registry.execute('todo_write', { todos: fifty }, toolCtx())
    expect(result.output).toContain(`- [pending] item ${TODO_MAX_ITEMS - 1}`)
    expect(store.listTodos()).toHaveLength(TODO_MAX_ITEMS)
  })

  it('is read-risk and therefore auto-approved by the policy', () => {
    const { store, session } = makeStore()
    const tool = makeTodoWriteTool({ store, session })
    expect(tool.risk).toBe('read')
    expect(new PermissionPolicy().requiresApproval(tool.name, tool.risk)).toBe(false)
  })
})

describe('todo_write (agent integration)', () => {
  /** memory-mode agent wired to the given store; mirrors the working-memory test rig */
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
      tools: new ToolRegistry([makeTodoWriteTool({ store, session })]),
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

  it('persists a model-driven list and injects it into the next turn system without a permission prompt', async () => {
    const { store, session } = makeStore()
    const todos = [
      { content: 'inspect the store', status: 'in_progress' as const },
      { content: 'write the report', status: 'pending' as const },
    ]
    let secondTurnMessages: ChatMessage[] | undefined
    const { agent, events, permissionAsks } = makeMemoryAgent(store, session, [
      reply({
        content: 'Tracking my tasks.',
        toolCalls: [
          {
            id: 'tw1',
            name: 'todo_write',
            arguments: JSON.stringify({ todos }),
          },
        ],
        finishReason: 'tool_calls',
      }),
      reply({ content: '{"passed": true, "note": "list saved"}' }), // verification
      reply({ content: 'I am now tracking two tasks.' }),
      (messages) => {
        secondTurnMessages = [...messages]
        return reply({ content: 'second answer' })
      },
    ])

    await runTurn(agent, 'track these tasks for me')
    await runTurn(agent, 'what are my tasks?')

    // the model's overwrite landed in the store
    expect(store.listTodos().map((t) => `${t.status}: ${t.content}`)).toEqual([
      'in_progress: inspect the store',
      'pending: write the report',
    ])

    // read-risk: executed with no permission prompt; tool output shows the list
    expect(permissionAsks()).toBe(0)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    const completed = events.filter((e) => e.type === 'tool_completed')
    expect(completed).toHaveLength(1)
    if (completed[0]?.type === 'tool_completed') {
      expect(completed[0].result).toContain('- [in_progress] inspect the store')
    }

    // next turn: the system message carries the Task List section with the entries
    expect(secondTurnMessages?.[0]?.role).toBe('system')
    const system = secondTurnMessages?.[0]?.content ?? ''
    expect(system).toContain('## Task List (maintained by todo_write')
    expect(system).toContain('- [in_progress] inspect the store')
    expect(system).toContain('- [pending] write the report')
  })
})
