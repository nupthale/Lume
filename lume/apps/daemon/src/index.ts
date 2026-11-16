#!/usr/bin/env node
import { runReplMode } from './cli/repl.js'
import { runStreamMode } from './cli/stream.js'
import { ConfigError, expandHomePath, loadConfig } from './config/config.js'
import { Agent } from './core/agent.js'
import { PermissionPolicy } from './core/permission.js'
import { EmbeddingClient } from './memory/embedding.js'
import { makeSaveMemoryTool } from './memory/save-memory-tool.js'
import { formatSearchResults, formatSessionDeletion, formatSessionList } from './memory/session.js'
import { type MemoryStore, type SessionRow, SqliteStore } from './memory/store.js'
import { makeTodoWriteTool } from './memory/todo-write-tool.js'
import { makeUpdateWorkingMemoryTool } from './memory/working-memory-tool.js'
import { FakeProvider, type FakeReply } from './providers/fake.js'
import { OpenAiCompatProvider } from './providers/openai-compat.js'
import { SkillIndex } from './skills/skills.js'
import { makeLoadSkillTool } from './skills/load-skill-tool.js'
import { ToolRegistry, defaultTools } from './tools/registry.js'
import { createLogger } from './util/logger.js'
import { ulid } from './util/ulid.js'

const USAGE = `lume - agent harness CLI

Usage:
  lume                        interactive REPL (terminal skin)
  lume --mode stream          stream-json skin over stdio (for GUI drivers)
  lume --session <id>         resume the given session (see --list-sessions)
  lume --list-sessions        list stored sessions and exit
  lume --list-sessions --json list stored sessions as JSON and exit
  lume --dump-session <id>    dump a session and its messages as JSON and exit
  lume --feedback <sessionId> <seq> <like>  set message feedback (-1, 0 or 1) and exit
  lume --delete-session <id>  delete a session with its messages, facts and todos
  lume --search <query>       search message contents across all sessions and exit
  lume --version              print version

Environment:
  LUME_API_BASE_URL     OpenAI-compatible base URL (required for real providers)
  LUME_API_KEY          API key (optional; default "EMPTY")
  LUME_MODEL            model name (required for real providers)
  LUME_PROVIDER         "openai" (default) or "fake" (scripted smoke tests)
  LUME_CWD              working directory for tools (default: process cwd)
  LUME_MAX_TOOL_LOOPS   max tool cycles per turn (default 25)
  LUME_AUTO_APPROVE_TOOLS  comma-separated tools that skip permission prompts
  LUME_DB_PATH           SQLite session memory file (default: ~/.lume/lume.db)
  LUME_EMBED_MODEL       embedding model for long-term memory recall (unset = disabled)
`

/** Session lookup failures: user-recoverable, exit code 2 like config errors. */
class SessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionError'
  }
}

class MachineQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MachineQueryError'
  }
}

interface CliArgs {
  mode: 'repl' | 'stream'
  help: boolean
  version: boolean
  /** resume this session instead of creating a new one */
  session?: string
  /** list stored sessions and exit */
  listSessions: boolean
  /** format the session listing as JSON */
  json: boolean
  /** dump this session as JSON and exit */
  dumpSession?: string
  /** set message feedback and exit */
  feedback?: { sessionId: string; messageSeq: number; likeType: number }
  /** delete this session (with its messages, facts and todos) and exit */
  deleteSession?: string
  /** search message contents across all sessions and exit */
  search?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2)
  let mode: 'repl' | 'stream' = 'repl'
  let help = false
  let version = false
  let session: string | undefined
  let listSessions = false
  let json = false
  let dumpSession: string | undefined
  let feedback: CliArgs['feedback']
  let deleteSession: string | undefined
  let search: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--mode' && args[i + 1] === 'stream') {
      mode = 'stream'
      i++
    } else if (arg === '--session') {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--session requires a session id\n\n${USAGE}`)
      }
      session = value
      i++
    } else if (arg === '--list-sessions') {
      listSessions = true
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--dump-session') {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--dump-session requires a session id\n\n${USAGE}`)
      }
      dumpSession = value
      i++
    } else if (arg === '--feedback') {
      const sessionId = args[i + 1]
      const seqValue = args[i + 2]
      const likeValue = args[i + 3]
      if (
        sessionId === undefined ||
        sessionId.startsWith('--') ||
        seqValue === undefined ||
        likeValue === undefined
      ) {
        throw new Error(`--feedback requires a session id, message seq and like\n\n${USAGE}`)
      }
      const messageSeq = Number(seqValue)
      const likeType = Number(likeValue)
      if (!Number.isInteger(messageSeq) || messageSeq < 1) {
        throw new Error(`--feedback message seq must be a positive integer\n\n${USAGE}`)
      }
      if (![-1, 0, 1].includes(likeType)) {
        throw new Error(`--feedback like must be -1, 0 or 1\n\n${USAGE}`)
      }
      feedback = { sessionId, messageSeq, likeType }
      i += 3
    } else if (arg === '--delete-session') {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--delete-session requires a session id\n\n${USAGE}`)
      }
      deleteSession = value
      i++
    } else if (arg === '--search') {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--search requires a query\n\n${USAGE}`)
      }
      search = value
      i++
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--version' || arg === '-v') {
      version = true
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${USAGE}`)
    }
  }
  if (json && !listSessions) {
    throw new Error(`--json requires --list-sessions\n\n${USAGE}`)
  }
  return {
    mode,
    help,
    version,
    session,
    listSessions,
    json,
    dumpSession,
    feedback,
    deleteSession,
    search,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  if (args.help) {
    process.stdout.write(USAGE)
    return
  }
  if (args.version) {
    process.stdout.write('lume 0.1.0\n')
    return
  }

  // listing is a pure store query: no provider/model config needed
  if (args.listSessions) {
    const store = new SqliteStore(dbPathFromEnv())
    try {
      const sessions = store.listSessions()
      if (args.json) {
        const rows = sessions.map((session) => ({
          id: session.id,
          title: session.title,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
          message_count: session.messageCount,
        }))
        process.stdout.write(`${JSON.stringify(rows)}\n`)
      } else {
        process.stdout.write(formatSessionList(sessions))
      }
    } finally {
      store.close()
    }
    return
  }

  if (args.dumpSession !== undefined) {
    const store = new SqliteStore(dbPathFromEnv())
    try {
      const session = store.getSession(args.dumpSession)
      if (session === null) {
        throw new MachineQueryError(`session not found: ${args.dumpSession}`)
      }
      const feedback = store.getFeedback(session.id)
      const dump = {
        id: session.id,
        title: session.title,
        messages: store.getMessages(session.id).map((message) => ({
          seq: message.seq,
          role: message.role,
          content: message.content,
          like: feedback.get(message.seq) ?? 0,
        })),
      }
      process.stdout.write(`${JSON.stringify(dump)}\n`)
    } finally {
      store.close()
    }
    return
  }

  if (args.feedback !== undefined) {
    const store = new SqliteStore(dbPathFromEnv())
    try {
      const { sessionId, messageSeq, likeType } = args.feedback
      store.setFeedback(sessionId, messageSeq, likeType)
      process.stdout.write('ok\n')
    } finally {
      store.close()
    }
    return
  }

  // deletion is a pure store operation: no provider/model config needed
  if (args.deleteSession !== undefined) {
    const id = args.deleteSession
    const store = new SqliteStore(dbPathFromEnv())
    try {
      if (store.getSession(id) === null) {
        throw new SessionError(
          `session not found: ${id}\nUse --list-sessions to see available sessions.`,
        )
      }
      const counts = store.sessionDeletionCounts(id)
      store.deleteSession(id)
      process.stdout.write(formatSessionDeletion(id, counts))
    } finally {
      store.close()
    }
    return
  }

  // search is a pure store query: no provider/model config needed
  if (args.search !== undefined) {
    const store = new SqliteStore(dbPathFromEnv())
    try {
      process.stdout.write(formatSearchResults(store.searchMessages(args.search)))
    } finally {
      store.close()
    }
    return
  }

  const config = loadConfig()
  const logger = createLogger(process.env.LUME_LOG_LEVEL === 'debug' ? 'debug' : 'info')

  const store = new SqliteStore(config.dbPath)
  try {
    const session =
      args.session === undefined
        ? store.createSession({ id: ulid(), cwd: config.cwd, model: config.model })
        : requireExistingSession(store, args.session)

    const provider =
      config.provider === 'fake'
        ? new FakeProvider(fakeScript())
        : new OpenAiCompatProvider({
            baseUrl: config.apiBaseUrl,
            apiKey: config.apiKey,
            model: config.model,
            timeoutMs: config.requestTimeoutMs,
            logger,
          })

    const skills = new SkillIndex(config.cwd, logger)
    const memory = { store, session }

    // Layer 3: constructed only when an embedding model is configured; an
    // absent embedder leaves save_memory unregistered and recall disabled
    // entirely (no keyword-search fallback)
    const embedder =
      config.embedModel !== undefined
        ? new EmbeddingClient({
            baseUrl: config.apiBaseUrl,
            apiKey: config.apiKey,
            model: config.embedModel,
            timeoutMs: config.requestTimeoutMs,
            logger,
          })
        : undefined

    const agent = new Agent({
      provider,
      tools: new ToolRegistry([
        ...defaultTools(),
        makeLoadSkillTool(skills),
        makeUpdateWorkingMemoryTool(memory),
        makeTodoWriteTool(memory),
        ...(embedder !== undefined
          ? [makeSaveMemoryTool({ embedder, store, session })]
          : []),
      ]),
      policy: new PermissionPolicy(config.autoApproveTools),
      config,
      logger,
      skills,
      memory,
      ...(embedder !== undefined ? { embedder } : {}),
    })

    if (args.mode === 'stream') {
      await runStreamMode(agent, logger, session.id)
    } else {
      await runReplMode(agent, logger, session.id)
    }
  } finally {
    store.close()
  }
}

function dbPathFromEnv(): string {
  return expandHomePath(process.env.LUME_DB_PATH ?? '~/.lume/lume.db')
}

/** Look up the session to resume; a bad id is a usage error, not a crash. */
function requireExistingSession(store: MemoryStore, id: string): SessionRow {
  const existing = store.getSession(id)
  if (existing === null) {
    throw new SessionError(
      `session not found: ${id}\nUse --list-sessions to see available sessions.`,
    )
  }
  return existing
}

/**
 * Smoke-test script for LUME_PROVIDER=fake: one tool round-trip then a final
 * answer (verification consumes one reply in between).
 */
function fakeScript(): FakeReply[] {
  return [
    {
      content: 'Let me look at the directory.',
      reasoning: 'The user wants a directory listing; use the bash tool.',
      toolCalls: [
        { id: 'fake_call_1', name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
      ],
      finishReason: 'tool_calls',
    },
    {
      content: '{"passed": true, "note": "listing returned"}',
      reasoning: '',
      toolCalls: [],
      finishReason: 'stop',
    },
    {
      content: 'Done: I listed the directory (see tool result above).',
      reasoning: '',
      toolCalls: [],
      finishReason: 'stop',
    },
  ]
}

main().catch((err) => {
  if (err instanceof MachineQueryError) {
    process.stderr.write(`lume: ${err.message}\n`)
    process.exit(1)
  }
  if (err instanceof ConfigError || err instanceof SessionError) {
    process.stderr.write(`lume: ${err.message}\n`)
    process.exit(2)
  }
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(`lume: fatal: ${message}\n`)
  process.exit(1)
})
