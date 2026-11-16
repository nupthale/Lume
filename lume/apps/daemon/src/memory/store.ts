import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { ulid } from '../util/ulid.js'

/** better-sqlite3 Database instance type (the module's export= shape hides it behind a constructor) */
type SqliteDatabase = InstanceType<typeof Database>

/**
 * Layered session memory storage.
 *
 * All SQL is confined to this module: the rest of the daemon talks to the
 * MemoryStore interface only, so the SQLite backend can later be swapped
 * for a remote database (e.g. Postgres + pgvector) with zero upstream change.
 *
 * Hard constraints enforced here:
 * - messages are append-only; appendMessage is the ONLY method that writes
 *   to the messages table and there is no UPDATE/DELETE path for it
 * - timestamps are ISO strings
 */

/** roles that are persisted to messages; system messages are rebuilt per turn and never stored */
export type MessageRole = 'user' | 'assistant' | 'tool'

export interface SessionRow {
  id: string
  createdAt: string
  updatedAt: string
  cwd: string
  model: string
  /** derived from the first user message, truncated; empty until then */
  title: string
  /** Layer 1: small structured user profile (JSON text), injected each turn */
  workingMemory: string
  /** rolling summary of messages below the watermark */
  summary: string
  /** watermark: messages with seq <= this are summarized and never re-enter the verbatim window */
  summarizedUntilSeq: number
  messageCount: number
}

export interface MessageRow {
  sessionId: string
  /** 1-based, monotonically increasing within a session */
  seq: number
  role: MessageRole
  content: string
  /** JSON-encoded tool_calls array (assistant messages); null when absent */
  toolCalls: string | null
  /** tool message: id of the tool_call it answers */
  toolCallId: string | null
  /** tool message: tool name */
  name: string | null
  createdAt: string
}

export interface FactRow {
  id: string
  content: string
  /** float32 little-endian embedding blob; null when Layer 3 is disabled */
  embedding: Buffer | null
  /** session the fact originated from */
  sessionId: string
  createdAt: string
}

export interface CreateSessionInput {
  id: string
  cwd: string
  model: string
}

export interface UpdateSessionPatch {
  title?: string
  workingMemory?: string
  summary?: string
  summarizedUntilSeq?: number
}

export interface AppendMessageInput {
  sessionId: string
  role: MessageRole
  content?: string
  /** assistant tool_calls array; stored as JSON text */
  toolCalls?: unknown[]
  toolCallId?: string
  name?: string
}

export interface GetMessagesOptions {
  /** return only messages with seq strictly greater than this (default 0 = all) */
  afterSeq?: number
  /** keep the newest `limit` messages of the matched set, returned in ascending seq order */
  limit?: number
}

export interface InsertFactInput {
  id: string
  content: string
  embedding?: Buffer | null
  sessionId: string
}

/** lifecycle of a todo item */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoRow {
  id: string
  content: string
  status: TodoStatus
  /** session the todo list was last rewritten from */
  originSessionId: string
  createdAt: string
  updatedAt: string
}

/** replaceTodos input: content + status only; ids and timestamps are store-assigned */
export type ReplaceTodosInput = Array<{ content: string; status: TodoStatus }>

export interface SessionDeletionCounts {
  messages: number
  facts: number
  todos: number
}

/** one --search hit: a matching message joined with its session title and a snippet */
export interface SearchMessageHit {
  sessionId: string
  seq: number
  role: string
  title: string
  snippet: string
}

export interface MemoryStore {
  createSession(input: CreateSessionInput): SessionRow
  getSession(id: string): SessionRow | null
  /** sessions ordered by updated_at descending */
  listSessions(limit?: number): SessionRow[]
  /** applies the given fields and advances updated_at */
  updateSession(id: string, patch: UpdateSessionPatch): void
  /** appends a message with the next seq; bumps sessions.message_count and updated_at atomically */
  appendMessage(input: AppendMessageInput): MessageRow
  getMessages(sessionId: string, opts?: GetMessagesOptions): MessageRow[]
  setFeedback(sessionId: string, messageSeq: number, likeType: number): void
  getFeedback(sessionId: string): Map<number, number>
  /** count of messages with seq > summarized_until_seq (pending summarization) */
  getUnsummarizedCount(sessionId: string): number
  insertFact(input: InsertFactInput): void
  listFacts(): FactRow[]
  /**
   * Overwrites the whole todo list in one transaction (todos are mutable
   * state, deliberately outside the append-only messages constraint).
   * Returns the freshly inserted rows.
   */
  replaceTodos(items: ReplaceTodosInput, originSessionId: string): TodoRow[]
  /** all todos: in_progress first, then pending, then completed; by created_at within a group */
  listTodos(): TodoRow[]
  /** deletes the session plus its messages, facts and todos; false when the id is unknown */
  deleteSession(id: string): boolean
  /** row counts a deleteSession would remove; zeros for an unknown session */
  sessionDeletionCounts(id: string): SessionDeletionCounts
  /** substring search across all sessions' messages, newest session first (limit default 50) */
  searchMessages(query: string, limit?: number): SearchMessageHit[]
  close(): void
}

/* -- internal DB row shapes (snake_case, as stored) -- */

interface SessionDbRow {
  id: string
  created_at: string
  updated_at: string
  cwd: string
  model: string
  title: string
  working_memory: string
  summary: string
  summarized_until_seq: number
  message_count: number
}

interface MessageDbRow {
  session_id: string
  seq: number
  role: string
  content: string
  tool_calls: string | null
  tool_call_id: string | null
  name: string | null
  created_at: string
}

interface FactDbRow {
  id: string
  content: string
  embedding: Buffer | null
  session_id: string
  created_at: string
}

interface TodoDbRow {
  id: string
  content: string
  status: string
  origin_session_id: string
  created_at: string
  updated_at: string
}

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cwd TEXT NOT NULL,
  model TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  working_memory TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  summarized_until_seq INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT,
  tool_call_id TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS feedback (
  session_id TEXT NOT NULL,
  message_seq INTEGER NOT NULL,
  like_type INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, message_seq)
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding BLOB,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  origin_session_id TEXT NOT NULL REFERENCES sessions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

function mapSessionRow(row: SessionDbRow): SessionRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cwd: row.cwd,
    model: row.model,
    title: row.title,
    workingMemory: row.working_memory,
    summary: row.summary,
    summarizedUntilSeq: row.summarized_until_seq,
    messageCount: row.message_count,
  }
}

function mapMessageRow(row: MessageDbRow): MessageRow {
  return {
    sessionId: row.session_id,
    seq: row.seq,
    role: row.role as MessageRole,
    content: row.content,
    toolCalls: row.tool_calls,
    toolCallId: row.tool_call_id,
    name: row.name,
    createdAt: row.created_at,
  }
}

function mapFactRow(row: FactDbRow): FactRow {
  return {
    id: row.id,
    content: row.content,
    embedding: row.embedding,
    sessionId: row.session_id,
    createdAt: row.created_at,
  }
}

function mapTodoRow(row: TodoDbRow): TodoRow {
  return {
    id: row.id,
    content: row.content,
    status: row.status as TodoStatus,
    originSessionId: row.origin_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** SQLite-backed MemoryStore. Pass '' or ':memory:' for an in-memory database. */
export class SqliteStore implements MemoryStore {
  private readonly db: SqliteDatabase
  private readonly appendTx: (input: AppendMessageInput) => MessageRow
  private readonly replaceTodosTx: (items: ReplaceTodosInput, originSessionId: string) => TodoRow[]
  private readonly deleteSessionTx: (id: string) => boolean

  constructor(dbPath: string) {
    const inMemory = dbPath === '' || dbPath === ':memory:'
    if (!inMemory) {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(inMemory ? ':memory:' : dbPath)
    this.db.pragma('foreign_keys = ON')
    if (!inMemory) {
      this.db.pragma('journal_mode = WAL')
    }
    this.db.exec(DDL)

    // Single transaction: allocate seq, insert the message, bump counters.
    // This is the ONLY code path that writes to messages (append-only).
    this.appendTx = this.db.transaction((input: AppendMessageInput): MessageRow => {
      const now = new Date().toISOString()
      const content = input.content ?? ''
      const toolCalls = input.toolCalls === undefined ? null : JSON.stringify(input.toolCalls)
      const toolCallId = input.toolCallId ?? null
      const name = input.name ?? null
      const seqRow = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE session_id = ?')
        .get(input.sessionId) as { next: number }
      this.db
        .prepare(
          `INSERT INTO messages (session_id, seq, role, content, tool_calls, tool_call_id, name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.sessionId, seqRow.next, input.role, content, toolCalls, toolCallId, name, now)
      this.db
        .prepare('UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?')
        .run(now, input.sessionId)
      return {
        sessionId: input.sessionId,
        seq: seqRow.next,
        role: input.role,
        content,
        toolCalls,
        toolCallId,
        name,
        createdAt: now,
      }
    })

    // Todos are mutable state (overwrite semantics): the whole list is
    // replaced atomically, unlike the append-only messages table.
    this.replaceTodosTx = this.db.transaction(
      (items: ReplaceTodosInput, originSessionId: string): TodoRow[] => {
        const now = new Date().toISOString()
        this.db.prepare('DELETE FROM todos').run()
        const insert = this.db.prepare(
          `INSERT INTO todos (id, content, status, origin_session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        const rows: TodoRow[] = items.map((item) => {
          const id = ulid()
          insert.run(id, item.content, item.status, originSessionId, now, now)
          return {
            id,
            content: item.content,
            status: item.status,
            originSessionId,
            createdAt: now,
            updatedAt: now,
          }
        })
        return rows
      },
    )

    // Referencing rows first, then the session row, so the FK never fires.
    this.deleteSessionTx = this.db.transaction((id: string): boolean => {
      const exists = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)
      if (exists === undefined) return false
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
      this.db.prepare('DELETE FROM facts WHERE session_id = ?').run(id)
      this.db.prepare('DELETE FROM todos WHERE origin_session_id = ?').run(id)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      return true
    })
  }

  createSession(input: CreateSessionInput): SessionRow {
    const now = new Date().toISOString()
    this.db
      .prepare('INSERT INTO sessions (id, created_at, updated_at, cwd, model) VALUES (?, ?, ?, ?, ?)')
      .run(input.id, now, now, input.cwd, input.model)
    return {
      id: input.id,
      createdAt: now,
      updatedAt: now,
      cwd: input.cwd,
      model: input.model,
      title: '',
      workingMemory: '',
      summary: '',
      summarizedUntilSeq: 0,
      messageCount: 0,
    }
  }

  getSession(id: string): SessionRow | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionDbRow
      | undefined
    return row === undefined ? null : mapSessionRow(row)
  }

  listSessions(limit?: number): SessionRow[] {
    const rows =
      limit === undefined
        ? (this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionDbRow[])
        : (this.db
            .prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?')
            .all(limit) as SessionDbRow[])
    return rows.map(mapSessionRow)
  }

  updateSession(id: string, patch: UpdateSessionPatch): void {
    const sets: string[] = ['updated_at = ?']
    const params: (string | number)[] = [new Date().toISOString()]
    if (patch.title !== undefined) {
      sets.push('title = ?')
      params.push(patch.title)
    }
    if (patch.workingMemory !== undefined) {
      sets.push('working_memory = ?')
      params.push(patch.workingMemory)
    }
    if (patch.summary !== undefined) {
      sets.push('summary = ?')
      params.push(patch.summary)
    }
    if (patch.summarizedUntilSeq !== undefined) {
      sets.push('summarized_until_seq = ?')
      params.push(patch.summarizedUntilSeq)
    }
    this.db
      .prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params, id)
  }

  appendMessage(input: AppendMessageInput): MessageRow {
    return this.appendTx(input)
  }

  getMessages(sessionId: string, opts: GetMessagesOptions = {}): MessageRow[] {
    const afterSeq = opts.afterSeq ?? 0
    let rows: MessageDbRow[]
    if (opts.limit === undefined) {
      rows = this.db
        .prepare('SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC')
        .all(sessionId, afterSeq) as MessageDbRow[]
    } else {
      // take the newest `limit` of the matched set, then return ascending
      rows = this.db
        .prepare('SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq DESC LIMIT ?')
        .all(sessionId, afterSeq, opts.limit) as MessageDbRow[]
      rows.reverse()
    }
    return rows.map(mapMessageRow)
  }

  setFeedback(sessionId: string, messageSeq: number, likeType: number): void {
    this.db
      .prepare(
        `INSERT INTO feedback (session_id, message_seq, like_type, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (session_id, message_seq) DO UPDATE SET
           like_type = excluded.like_type,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, messageSeq, likeType, new Date().toISOString())
  }

  getFeedback(sessionId: string): Map<number, number> {
    const rows = this.db
      .prepare('SELECT message_seq, like_type FROM feedback WHERE session_id = ?')
      .all(sessionId) as Array<{ message_seq: number; like_type: number }>
    return new Map(rows.map((row) => [row.message_seq, row.like_type]))
  }

  getUnsummarizedCount(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE session_id = ? AND seq > (SELECT summarized_until_seq FROM sessions WHERE id = ?)`,
      )
      .get(sessionId, sessionId) as { n: number }
    return row.n
  }

  insertFact(input: InsertFactInput): void {
    this.db
      .prepare('INSERT INTO facts (id, content, embedding, session_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.id, input.content, input.embedding ?? null, input.sessionId, new Date().toISOString())
  }

  listFacts(): FactRow[] {
    const rows = this.db
      .prepare('SELECT * FROM facts ORDER BY created_at ASC, rowid ASC')
      .all() as FactDbRow[]
    return rows.map(mapFactRow)
  }

  replaceTodos(items: ReplaceTodosInput, originSessionId: string): TodoRow[] {
    return this.replaceTodosTx(items, originSessionId)
  }

  listTodos(): TodoRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM todos
         ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                  created_at ASC, rowid ASC`,
      )
      .all() as TodoDbRow[]
    return rows.map(mapTodoRow)
  }

  deleteSession(id: string): boolean {
    return this.deleteSessionTx(id)
  }

  sessionDeletionCounts(id: string): SessionDeletionCounts {
    const messages = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?')
      .get(id) as { n: number }
    const facts = this.db
      .prepare('SELECT COUNT(*) AS n FROM facts WHERE session_id = ?')
      .get(id) as { n: number }
    const todos = this.db
      .prepare('SELECT COUNT(*) AS n FROM todos WHERE origin_session_id = ?')
      .get(id) as { n: number }
    return { messages: messages.n, facts: facts.n, todos: todos.n }
  }

  searchMessages(query: string, limit = 50): SearchMessageHit[] {
    // LIKE wildcards in the query must match literally; escape them for the
    // ESCAPE '\' clause (the backslash itself is escaped first)
    const escaped = query.replace(/([\\%_])/g, '\\$1')
    const rows = this.db
      .prepare(
        `SELECT m.session_id, m.seq, m.role, m.content, s.title
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE m.content LIKE ? ESCAPE '\\'
         ORDER BY s.updated_at DESC, m.seq ASC
         LIMIT ?`,
      )
      .all(`%${escaped}%`, limit) as Array<{
      session_id: string
      seq: number
      role: string
      content: string
      title: string
    }>
    return rows.map((row) => ({
      sessionId: row.session_id,
      seq: row.seq,
      role: row.role,
      title: row.title,
      snippet: makeSnippet(row.content, query),
    }))
  }

  close(): void {
    this.db.close()
  }
}

/** 40 chars of context on each side of the first match (LIKE is ASCII case-insensitive) */
function makeSnippet(content: string, query: string): string {
  if (query === '') return content
  const idx = content.toLowerCase().indexOf(query.toLowerCase())
  const pos = idx >= 0 ? idx : 0
  const start = Math.max(0, pos - 40)
  const end = Math.min(content.length, pos + query.length + 40)
  return content.slice(start, end)
}
