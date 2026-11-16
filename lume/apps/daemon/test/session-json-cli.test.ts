import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteStore } from '../src/memory/store.js'

const daemonDir = path.resolve(import.meta.dirname, '..')

let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lume-session-json-cli-'))
  dbPath = path.join(dir, 'lume.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function runCli(...args: string[]) {
  const env = {
    ...process.env,
    LUME_DB_PATH: dbPath,
    LUME_API_BASE_URL: undefined,
    LUME_MODEL: undefined,
  }

  const result = spawnSync('npx', ['tsx', 'src/index.ts', ...args], {
    cwd: daemonDir,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.error !== undefined) throw result.error
  return result
}

describe('machine-readable session CLI', () => {
  it('lists an empty JSON array without provider configuration', () => {
    const result = runCli('--list-sessions', '--json')

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('[]\n')
    expect(result.stderr).toBe('')
  })

  it('lists sessions with snake_case fields ordered by updated_at descending', async () => {
    const store = new SqliteStore(dbPath)
    store.createSession({ id: 'older', cwd: '/work', model: 'm' })
    store.updateSession('older', { title: 'older title' })
    store.appendMessage({ sessionId: 'older', role: 'user', content: 'hello' })
    store.appendMessage({ sessionId: 'older', role: 'assistant', content: 'hi' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    store.createSession({ id: 'newer', cwd: '/work', model: 'm' })
    store.updateSession('newer', { title: 'newer title' })
    const older = store.getSession('older')
    const newer = store.getSession('newer')
    store.close()
    if (older === null || newer === null) throw new Error('seed sessions missing')

    const result = runCli('--list-sessions', '--json')

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      {
        id: newer.id,
        title: newer.title,
        created_at: newer.createdAt,
        updated_at: newer.updatedAt,
        message_count: newer.messageCount,
      },
      {
        id: older.id,
        title: older.title,
        created_at: older.createdAt,
        updated_at: older.updatedAt,
        message_count: older.messageCount,
      },
    ])
    expect(result.stderr).toBe('')
  })

  it('dumps all message roles in seq order without assistant tool_calls', () => {
    const store = new SqliteStore(dbPath)
    store.createSession({ id: 'dump-me', cwd: '/work', model: 'm' })
    store.updateSession('dump-me', { title: 'dump title' })
    store.appendMessage({ sessionId: 'dump-me', role: 'user', content: 'question' })
    store.appendMessage({
      sessionId: 'dump-me',
      role: 'assistant',
      content: 'calling a tool',
      toolCalls: [{ id: 'call-1', name: 'bash', arguments: '{}' }],
    })
    store.appendMessage({
      sessionId: 'dump-me',
      role: 'tool',
      content: 'tool result',
      toolCallId: 'call-1',
      name: 'bash',
    })
    store.close()

    const result = runCli('--dump-session', 'dump-me')

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'dump-me',
      title: 'dump title',
      messages: [
        { seq: 1, role: 'user', content: 'question', like: 0 },
        { seq: 2, role: 'assistant', content: 'calling a tool', like: 0 },
        { seq: 3, role: 'tool', content: 'tool result', like: 0 },
      ],
    })
    expect(result.stderr).toBe('')
  })

  it('reports a missing dump session on stderr and exits with code 1', () => {
    const result = runCli('--dump-session', 'missing')

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('lume: session not found: missing\n')
  })

  it('upserts feedback and reflects each like value in the session dump', () => {
    const store = new SqliteStore(dbPath)
    store.createSession({ id: 'feedback-session', cwd: '/work', model: 'm' })
    store.appendMessage({ sessionId: 'feedback-session', role: 'user', content: 'question' })
    store.appendMessage({ sessionId: 'feedback-session', role: 'assistant', content: 'answer' })
    store.close()

    for (const like of [1, -1, 0]) {
      const feedback = runCli('--feedback', 'feedback-session', '2', String(like))
      expect(feedback.status).toBe(0)
      expect(feedback.stdout).toBe('ok\n')
      expect(feedback.stderr).toBe('')

      const dump = runCli('--dump-session', 'feedback-session')
      expect(dump.status).toBe(0)
      const parsed = JSON.parse(dump.stdout) as {
        messages: Array<{ seq: number; like: number }>
      }
      expect(parsed.messages.map((message) => [message.seq, message.like])).toEqual([
        [1, 0],
        [2, like],
      ])
    }

    const reopened = new SqliteStore(dbPath)
    expect(reopened.getFeedback('feedback-session')).toEqual(new Map([[2, 0]]))
    reopened.close()
  }, 30_000)
})
