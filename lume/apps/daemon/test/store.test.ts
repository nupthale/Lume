import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteStore } from '../src/memory/store.js'
import type { SqliteStore as SqliteStoreType } from '../src/memory/store.js'

let dir: string
let store: SqliteStoreType | undefined

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lume-store-'))
})

afterEach(() => {
  store?.close()
  store = undefined
  rmSync(dir, { recursive: true, force: true })
})

/** open a store on a file inside the temp dir; auto-closed in afterEach */
function openStore(filename = 'lume.db'): SqliteStoreType {
  store = new SqliteStore(path.join(dir, filename))
  return store
}

function seedSession(st: SqliteStoreType, id = 's1') {
  return st.createSession({ id, cwd: '/work', model: 'test-model' })
}

describe('SqliteStore schema', () => {
  it('opens the same db path twice without error (idempotent CREATE TABLE IF NOT EXISTS)', () => {
    const dbPath = path.join(dir, 'lume.db')
    const first = new SqliteStore(dbPath)
    seedSession(first)
    first.appendMessage({ sessionId: 's1', role: 'user', content: 'hello' })
    first.close()

    const second = new SqliteStore(dbPath) // must not throw; data survives
    const session = second.getSession('s1')
    expect(session?.id).toBe('s1')
    expect(session?.messageCount).toBe(1)
    expect(second.getMessages('s1')).toHaveLength(1)
    second.close()
  })

  it('creates a session with correct defaults', () => {
    const st = openStore()
    const created = seedSession(st)
    expect(created.title).toBe('')
    expect(created.workingMemory).toBe('')
    expect(created.summary).toBe('')
    expect(created.summarizedUntilSeq).toBe(0)
    expect(created.messageCount).toBe(0)
    expect(created.cwd).toBe('/work')
    expect(created.model).toBe('test-model')
    // timestamps are ISO strings
    expect(() => new Date(created.createdAt).toISOString()).not.toThrow()
    expect(new Date(created.updatedAt).toISOString()).toBe(created.updatedAt)

    expect(st.getSession('s1')).toEqual(created)
    expect(st.getSession('does-not-exist')).toBeNull()
  })
})

describe('SqliteStore messages', () => {
  it('appends messages with seq starting at 1, monotonically increasing; message_count tracks', () => {
    const st = openStore()
    seedSession(st)

    const m1 = st.appendMessage({ sessionId: 's1', role: 'user', content: 'hi' })
    const m2 = st.appendMessage({
      sessionId: 's1',
      role: 'assistant',
      content: 'calling a tool',
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'bash', arguments: '{}' } }],
    })
    const m3 = st.appendMessage({
      sessionId: 's1',
      role: 'tool',
      content: 'tool output',
      toolCallId: 'call-1',
      name: 'bash',
    })

    expect(m1.seq).toBe(1)
    expect(m2.seq).toBe(2)
    expect(m3.seq).toBe(3)
    expect(m1.content).toBe('hi')
    expect(m1.toolCalls).toBeNull()
    expect(m1.toolCallId).toBeNull()
    expect(m1.name).toBeNull()
    expect(m2.toolCalls).toBe(
      JSON.stringify([{ id: 'call-1', type: 'function', function: { name: 'bash', arguments: '{}' } }]),
    )
    expect(m3.toolCallId).toBe('call-1')
    expect(m3.name).toBe('bash')
    expect(st.getSession('s1')?.messageCount).toBe(3)

    // sessions are isolated: another session's seq restarts at 1
    seedSession(st, 's2')
    const other = st.appendMessage({ sessionId: 's2', role: 'user', content: 'other' })
    expect(other.seq).toBe(1)
    expect(st.getSession('s2')?.messageCount).toBe(1)
    expect(st.getSession('s1')?.messageCount).toBe(3)
  })

  it('getMessages: afterSeq is strictly-greater; limit keeps the newest then returns ascending', () => {
    const st = openStore()
    seedSession(st)
    for (let i = 1; i <= 5; i++) {
      st.appendMessage({ sessionId: 's1', role: 'user', content: `m${i}` })
    }

    expect(st.getMessages('s1').map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    // afterSeq: strictly greater than
    expect(st.getMessages('s1', { afterSeq: 2 }).map((m) => m.seq)).toEqual([3, 4, 5])
    expect(st.getMessages('s1', { afterSeq: 5 })).toEqual([])
    // limit: newest K of the matched set, returned in ascending order
    expect(st.getMessages('s1', { limit: 2 }).map((m) => m.seq)).toEqual([4, 5])
    expect(st.getMessages('s1', { limit: 100 }).map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    // combined: window above the watermark
    expect(st.getMessages('s1', { afterSeq: 1, limit: 2 }).map((m) => m.seq)).toEqual([4, 5])
    expect(st.getMessages('s1', { afterSeq: 3, limit: 2 }).map((m) => m.seq)).toEqual([4, 5])
    // content round-trips
    expect(st.getMessages('s1', { limit: 1 })[0]?.content).toBe('m5')
  })

  it('getUnsummarizedCount shrinks as updateSession advances the watermark', () => {
    const st = openStore()
    seedSession(st)
    for (let i = 0; i < 4; i++) {
      st.appendMessage({ sessionId: 's1', role: 'user', content: 'x' })
    }
    expect(st.getUnsummarizedCount('s1')).toBe(4)

    st.updateSession('s1', { summarizedUntilSeq: 2 })
    expect(st.getUnsummarizedCount('s1')).toBe(2)
    expect(st.getSession('s1')?.summarizedUntilSeq).toBe(2)
    // already-summarized messages are excluded from the verbatim window
    expect(st.getMessages('s1', { afterSeq: 2 }).map((m) => m.seq)).toEqual([3, 4])
  })

  it('updateSession patches fields and advances updated_at', () => {
    const st = openStore()
    const created = seedSession(st)
    const before = st.getSession('s1')?.updatedAt

    st.updateSession('s1', { title: 'first topic', workingMemory: '{"name":"hale"}', summary: 'so far...' })
    const patched = st.getSession('s1')
    expect(patched?.title).toBe('first topic')
    expect(patched?.workingMemory).toBe('{"name":"hale"}')
    expect(patched?.summary).toBe('so far...')
    expect(new Date(patched?.updatedAt ?? '').getTime()).toBeGreaterThanOrEqual(
      new Date(before ?? created.updatedAt).getTime(),
    )

    // partial patch leaves other fields alone
    st.updateSession('s1', { title: 'renamed' })
    const again = st.getSession('s1')
    expect(again?.title).toBe('renamed')
    expect(again?.summary).toBe('so far...')
  })
})

describe('SqliteStore facts', () => {
  it('inserts and lists facts with a byte-identical embedding round-trip', () => {
    const st = openStore()
    seedSession(st)

    const embedding = Buffer.from(new Float32Array([0.1, -0.2, 0.3]).buffer)
    st.insertFact({ id: 'f1', content: 'allergic to peanuts', embedding, sessionId: 's1' })
    st.insertFact({ id: 'f2', content: 'no embedding configured', sessionId: 's1' })

    const facts = st.listFacts()
    expect(facts.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(facts[0]?.content).toBe('allergic to peanuts')
    expect(facts[0]?.sessionId).toBe('s1')
    expect(Buffer.isBuffer(facts[0]?.embedding)).toBe(true)
    expect(Buffer.compare(facts[0]!.embedding!, embedding)).toBe(0)
    // decode back to float32 with identical values
    const decoded = new Float32Array(
        facts[0]!.embedding!.buffer,
        facts[0]!.embedding!.byteOffset,
        facts[0]!.embedding!.byteLength / 4,
      )
    expect([...decoded]).toEqual([...new Float32Array([0.1, -0.2, 0.3])])
    expect(facts[1]?.embedding).toBeNull()
    expect(() => new Date(facts[0]?.createdAt ?? 'not-iso').toISOString()).not.toThrow()
  })
})

describe('SqliteStore sessions listing', () => {
  it('lists sessions by updated_at descending, optionally limited', async () => {
    const st = openStore()
    st.createSession({ id: 'old', cwd: '/w', model: 'm' })
    st.createSession({ id: 'newer', cwd: '/w', model: 'm' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    // appending refreshes updated_at, making 'old' the most recent
    st.appendMessage({ sessionId: 'old', role: 'user', content: 'bump' })

    expect(st.listSessions().map((s) => s.id)).toEqual(['old', 'newer'])
    expect(st.listSessions(1).map((s) => s.id)).toEqual(['old'])
    expect(st.listSessions(0)).toEqual([])
  })
})

describe('SqliteStore :memory:', () => {
  it('supports in-memory databases via empty string or :memory:', () => {
    for (const memoryPath of ['', ':memory:']) {
      const st = new SqliteStore(memoryPath)
      seedSession(st)
      st.appendMessage({ sessionId: 's1', role: 'user', content: 'hi' })
      expect(st.getSession('s1')?.messageCount).toBe(1)
      st.close()
    }
  })
})
