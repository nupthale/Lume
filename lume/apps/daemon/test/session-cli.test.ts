import { describe, expect, it } from 'vitest'
import { formatSearchResults, formatSessionDeletion } from '../src/memory/session.js'
import type { SearchMessageHit } from '../src/memory/store.js'
import { SqliteStore } from '../src/memory/store.js'

/** fresh in-memory store */
function makeStore(): SqliteStore {
  return new SqliteStore(':memory:')
}

describe('SqliteStore deleteSession', () => {
  it('cascades: removes messages, facts and todos, no FK error, and clears the session row', () => {
    const store = makeStore()
    store.createSession({ id: 'doomed', cwd: '/work', model: 'm' })
    store.createSession({ id: 'kept', cwd: '/work', model: 'm' })
    for (const sessionId of ['doomed', 'kept']) {
      store.appendMessage({ sessionId, role: 'user', content: 'hello' })
      store.appendMessage({ sessionId, role: 'assistant', content: 'hi back' })
      store.insertFact({ id: `fact-${sessionId}`, content: `fact of ${sessionId}`, sessionId })
    }
    store.replaceTodos([{ content: 'orphan soon', status: 'pending' }], 'doomed')

    const counts = store.sessionDeletionCounts('doomed')
    expect(counts).toEqual({ messages: 2, facts: 1, todos: 1 })

    expect(store.deleteSession('doomed')).toBe(true)

    // everything referencing the session is gone
    expect(store.getSession('doomed')).toBeNull()
    expect(store.getMessages('doomed')).toEqual([])
    expect(store.listFacts().map((f) => f.sessionId)).toEqual(['kept'])
    expect(store.listTodos()).toEqual([])
    // listSessions no longer offers it
    expect(store.listSessions().map((s) => s.id)).toEqual(['kept'])

    // the surviving session is untouched
    expect(store.getMessages('kept')).toHaveLength(2)
  })

  it('returns false for an unknown session and stores nothing', () => {
    const store = makeStore()
    store.createSession({ id: 'real', cwd: '/work', model: 'm' })
    store.replaceTodos([{ content: 'task', status: 'pending' }], 'real')

    expect(store.deleteSession('no-such-session')).toBe(false)
    expect(store.getSession('real')).not.toBeNull()
    expect(store.listTodos()).toHaveLength(1)

    // a second delete of a now-deleted session is also just false
    expect(store.deleteSession('real')).toBe(true)
    expect(store.deleteSession('real')).toBe(false)
  })
})

describe('SqliteStore searchMessages', () => {
  /** two sessions with known message contents and distinct updated_at stamps */
  function seedSearchStore(): SqliteStore {
    const store = makeStore()
    store.createSession({ id: 'older', cwd: '/work', model: 'm' })
    store.updateSession('older', { title: 'older session' })
    store.appendMessage({ sessionId: 'older', role: 'user', content: 'needle in the first session' })
    store.appendMessage({ sessionId: 'older', role: 'assistant', content: 'nothing here' })
    return store
  }

  it('matches a plain substring and joins the session title', () => {
    const store = seedSearchStore()
    const hits = store.searchMessages('needle')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      sessionId: 'older',
      seq: 1,
      role: 'user',
      title: 'older session',
    })
    expect(hits[0]?.snippet).toContain('needle')
  })

  it('escapes LIKE wildcards: % and _ match literally', () => {
    const store = makeStore()
    store.createSession({ id: 's1', cwd: '/work', model: 'm' })
    store.appendMessage({ sessionId: 's1', role: 'user', content: 'discount is 50% today' })
    store.appendMessage({ sessionId: 's1', role: 'user', content: 'price is 100 dollars' })
    store.appendMessage({ sessionId: 's1', role: 'user', content: 'snake_case_name' })
    store.appendMessage({ sessionId: 's1', role: 'user', content: 'snakeXcaseXname' })

    // '%' must not act as a wildcard: only literal-percent messages match
    expect(store.searchMessages('%').map((h) => h.seq)).toEqual([1])
    expect(store.searchMessages('50%').map((h) => h.seq)).toEqual([1])
    // '_' must not act as a single-char wildcard
    expect(store.searchMessages('snake_case').map((h) => h.seq)).toEqual([3])
    // a backslash in the query is a literal too
    store.appendMessage({ sessionId: 's1', role: 'user', content: 'a \\ b backslash' })
    expect(store.searchMessages('\\ b').map((h) => h.seq)).toEqual([5])
  })

  it('takes a 40-char snippet around the first match', () => {
    const store = makeStore()
    store.createSession({ id: 's1', cwd: '/work', model: 'm' })
    const left = 'L'.repeat(60)
    const right = 'R'.repeat(60)
    store.appendMessage({ sessionId: 's1', role: 'user', content: `${left}needle${right}` })

    const hit = store.searchMessages('needle')[0]
    expect(hit?.snippet).toBe(`${'L'.repeat(40)}needle${'R'.repeat(40)}`)

    // a match near the start clamps instead of underflowing
    store.appendMessage({ sessionId: 's1', role: 'user', content: 'needle at the very beginning' })
    const early = store.searchMessages('needle').find((h) => h.seq === 2)
    expect(early?.snippet.startsWith('needle at')).toBe(true)
  })

  it('orders by session updated_at DESC then seq ASC, honoring the limit', async () => {
    const store = seedSearchStore() // 'older' already has a needle at seq 1
    // ensure the newer session's updated_at is strictly greater
    await new Promise((resolve) => setTimeout(resolve, 3))
    store.createSession({ id: 'newer', cwd: '/work', model: 'm' })
    store.updateSession('newer', { title: 'newer session' })
    store.appendMessage({ sessionId: 'newer', role: 'user', content: 'second needle' })
    store.appendMessage({ sessionId: 'newer', role: 'assistant', content: 'needle answer' })
    store.appendMessage({ sessionId: 'newer', role: 'user', content: 'first needle mention' })

    const hits = store.searchMessages('needle')
    expect(hits.map((h) => `${h.sessionId}:${h.seq}`)).toEqual([
      'newer:1',
      'newer:2',
      'newer:3',
      'older:1',
    ])

    expect(store.searchMessages('needle', 2)).toHaveLength(2)
    expect(store.searchMessages('needle', 0)).toHaveLength(0)
  })
})

describe('formatSessionDeletion', () => {
  it('reports the id and the removed row counts', () => {
    expect(formatSessionDeletion('abc', { messages: 3, facts: 2, todos: 1 })).toBe(
      'deleted session abc (3 messages, 2 facts, 1 todos)\n',
    )
    expect(formatSessionDeletion('abc', { messages: 0, facts: 0, todos: 0 })).toBe(
      'deleted session abc (0 messages, 0 facts, 0 todos)\n',
    )
  })
})

describe('formatSearchResults', () => {
  /** SearchMessageHit with overridable fields */
  function hit(overrides: Partial<SearchMessageHit> = {}): SearchMessageHit {
    return {
      sessionId: '01JTESTSESSIONID0000000',
      seq: 1,
      role: 'user',
      title: 'a topic',
      snippet: 'some snippet text',
      ...overrides,
    }
  }

  it('reports an empty hit list', () => {
    expect(formatSearchResults([])).toBe('No matches.\n')
  })

  it('aligns id, title, seq, role and snippet columns', () => {
    const rows = [
      hit(),
      hit({ seq: 2, role: 'assistant', title: '', snippet: 'other snippet' }),
    ]
    const out = formatSearchResults(rows)
    const lines = out.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(3) // header + one line per hit

    expect(lines[0]).toContain('ID')
    expect(lines[0]).toContain('TITLE')
    expect(lines[0]).toContain('SEQ')
    expect(lines[0]).toContain('ROLE')
    expect(lines[0]).toContain('SNIPPET')
    for (const row of rows) {
      expect(out).toContain(row.sessionId)
    }
    expect(out).toContain('a topic')
    expect(out).toContain('(no title)')
    expect(out).toContain('other snippet')

    // the first four columns are padded; both snippets start at the same offset
    const snippetOffset = 26 + 2 + 40 + 2 + 4 + 2 + 9 + 2
    expect((lines[1] ?? '').indexOf('some snippet text')).toBe(snippetOffset)
    expect((lines[2] ?? '').indexOf('other snippet')).toBe(snippetOffset)
  })

  it('single-lines and truncates long snippets', () => {
    const rows = [hit({ snippet: 'a\n  b\t\tc ' + 'x'.repeat(100) })]
    const out = formatSearchResults(rows)
    const line = out.split('\n').filter((l) => l.length > 0)[1] ?? ''
    expect(out).toContain('a b c ')
    // newlines collapsed and the line is capped at 80 chars with an ellipsis
    expect(line).not.toContain('\t')
    expect(out).toContain('…')
    expect(line.endsWith('…')).toBe(true)
  })
})
