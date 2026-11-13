import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { PermissionPolicy } from '../src/core/permission.js'
import { deriveTitle, formatSessionList } from '../src/memory/session.js'
import type { SessionRow } from '../src/memory/store.js'
import { SqliteStore } from '../src/memory/store.js'
import { FakeProvider } from '../src/providers/fake.js'
import type { AssistantReply } from '../src/providers/types.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { createLogger } from '../src/util/logger.js'
import { ulid } from '../src/util/ulid.js'

const logger = createLogger('error')
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lume-session-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** decode the 10-char timestamp prefix back to milliseconds */
function decodeUlTime(id: string): number {
  let t = 0
  for (const ch of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(ch)
  return t
}

describe('ulid', () => {
  it('produces 26-char Crockford base32 ids (no I/L/O/U, lowercase)', () => {
    for (let i = 0; i < 100; i++) {
      const id = ulid()
      expect(id).toMatch(ULID_RE)
      expect(id).toBe(id.toUpperCase())
    }
  })

  it('encodes the current millisecond in the first 10 chars', () => {
    const before = Date.now()
    const id = ulid()
    const after = Date.now()
    expect(decodeUlTime(id)).toBeGreaterThanOrEqual(before)
    expect(decodeUlTime(id)).toBeLessThanOrEqual(after)
  })

  it('is strictly increasing and collision-free across a tight loop', () => {
    const ids = Array.from({ length: 1000 }, () => ulid())
    // generation order equals lexicographic order (same-ms calls increment)
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(1000)
  })
})

describe('session restart continuity', () => {
  it('round-trips a session through a fresh store with seq continuing (3 -> 4)', () => {
    const dbPath = path.join(dir, 'lume.db')

    const first = new SqliteStore(dbPath)
    const created = first.createSession({ id: ulid(), cwd: '/work', model: 'test-model' })
    first.appendMessage({ sessionId: created.id, role: 'user', content: 'a' })
    first.appendMessage({ sessionId: created.id, role: 'assistant', content: 'b' })
    first.appendMessage({ sessionId: created.id, role: 'user', content: 'c' })
    first.close()

    // simulate a daemon restart: brand-new store instance on the same file
    const reopened = new SqliteStore(dbPath)
    const restored = reopened.getSession(created.id)
    expect(restored).not.toBeNull()
    expect(restored?.id).toBe(created.id)
    expect(restored?.messageCount).toBe(3)

    const next = reopened.appendMessage({ sessionId: created.id, role: 'assistant', content: 'd' })
    expect(next.seq).toBe(4) // never rewinds below existing messages
    expect(reopened.getSession(created.id)?.messageCount).toBe(4)
    reopened.close()
  })
})

describe('deriveTitle', () => {
  it('trims surrounding whitespace and collapses inner runs', () => {
    expect(deriveTitle('  hello \n world  ')).toBe('hello world')
    expect(deriveTitle('\ttabs\tand  spaces\t')).toBe('tabs and spaces')
    expect(deriveTitle('')).toBe('')
    expect(deriveTitle('   ')).toBe('')
  })

  it('truncates to 60 characters', () => {
    expect(deriveTitle('x'.repeat(100))).toHaveLength(60)
    expect(deriveTitle('x'.repeat(100))).toBe('x'.repeat(60))
    expect(deriveTitle('short')).toBe('short')
  })
})

describe('Agent session title (first user message)', () => {
  function reply(partial: Partial<AssistantReply>): AssistantReply {
    return { content: '', reasoning: '', toolCalls: [], finishReason: 'stop', ...partial }
  }

  async function makeTitledAgent(
    store: SqliteStore,
    session: SessionRow,
    replies: AssistantReply[],
  ): Promise<Agent> {
    const frontend: Frontend = { emit: () => {}, requestPermission: async () => true }
    const agent = new Agent({
      provider: new FakeProvider(replies),
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: ConfigSchema.parse({ apiBaseUrl: 'http://localhost:1/v1', model: 'm', cwd: dir }),
      logger,
      memory: { store, session },
    })
    agent.attachFrontend(frontend)
    return agent
  }

  async function runTurns(agent: Agent, contents: string[]): Promise<void> {
    for (const content of contents) {
      agent.submit(content)
      while (agent.isBusy) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
  }

  it('titles the session from the first user message, truncated and trimmed', async () => {
    const store = new SqliteStore(path.join(dir, 'lume.db'))
    const session = store.createSession({ id: ulid(), cwd: dir, model: 'm' })
    const agent = await makeTitledAgent(
      store,
      session,
      [reply({ content: 'ok' }), reply({ content: 'ok' })],
    )

    const longMessage = '  alpha \n beta  ' + 'g'.repeat(80)
    await runTurns(agent, [longMessage])

    const expected = 'alpha beta ' + 'g'.repeat(49) // 60 chars total
    expect(store.getSession(session.id)?.title).toBe(expected)

    // a later user message must NOT overwrite the title
    await runTurns(agent, ['a completely different topic'])
    expect(store.getSession(session.id)?.title).toBe(expected)
    store.close()
  })

  it('never overwrites the title of a resumed session', async () => {
    const store = new SqliteStore(path.join(dir, 'lume.db'))
    store.createSession({ id: 'preset-session', cwd: dir, model: 'm' })
    store.updateSession('preset-session', { title: 'preset title' })
    const resumed = store.getSession('preset-session')
    expect(resumed).not.toBeNull()

    const agent = await makeTitledAgent(store, resumed!, [reply({ content: 'ok' })])
    await runTurns(agent, ['hello again'])

    expect(store.getSession('preset-session')?.title).toBe('preset title')
    store.close()
  })
})

describe('formatSessionList', () => {
  function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
    return {
      id: ulid(),
      createdAt: new Date('2026-11-13T02:34:56Z').toISOString(),
      updatedAt: new Date('2026-11-13T02:34:56Z').toISOString(),
      cwd: '/tmp',
      model: 'm',
      title: '',
      workingMemory: '',
      summary: '',
      summarizedUntilSeq: 0,
      messageCount: 0,
      ...overrides,
    }
  }

  it('reports an empty listing', () => {
    expect(formatSessionList([])).toBe('No sessions found.\n')
  })

  it('aligns id, created_at, title and message count', () => {
    const rows = [
      sessionRow({ title: 'a topic', messageCount: 3 }),
      sessionRow({ title: '', messageCount: 0 }),
    ]
    const out = formatSessionList(rows)
    const lines = out.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(3) // header + one line per row

    // every column is padded: all lines share the same width
    const widths = new Set(lines.map((l) => l.length))
    expect(widths.size).toBe(1)

    expect(lines[0]).toContain('ID')
    expect(lines[0]).toContain('CREATED')
    expect(lines[0]).toContain('TITLE')
    expect(lines[0]).toContain('MSGS')
    for (const row of rows) {
      expect(out).toContain(row.id)
    }
    expect(out).toContain('(no title)')
    expect(out).toContain('a topic')
    // local-timezone readable timestamp: YYYY-MM-DD HH:mm:ss
    expect(out).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    // message counts are present, right-aligned
    expect(out).toMatch(/\s{2,}3\n/)
    expect(out).toMatch(/\s{2,}0\n/)
  })
})
