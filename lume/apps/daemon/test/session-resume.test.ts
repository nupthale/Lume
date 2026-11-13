import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '../src/core/prompts.js'
import type { ChatMessage } from '../src/providers/types.js'
import { DaemonProc, daemonEntry } from './helpers/daemon-proc.js'

/**
 * Two-process session-resume integration test (fake provider, real SQLite
 * file): process A starts a session and completes a scripted turn; process B
 * "restarts" against the same LUME_DB_PATH with `--session <id>` and continues
 * the conversation. Asserts cross-process seq continuity, a single sessions
 * row, and the provider-visible context rebuild in B (reconstructed system
 * message + A's verbatim window + the new user message).
 *
 * The fake script (src/index.ts fakeScript) holds exactly 3 replies per
 * process: the bash call, the verification verdict and the final answer. One
 * user message consumes all three, so each process drives exactly one full
 * turn; process B gets a fresh script from the top.
 */

interface SessionDbRow {
  id: string
  title: string
  message_count: number
  summarized_until_seq: number
}

interface MessageDbRow {
  session_id: string
  seq: number
  role: string
  content: string
  tool_calls: string | null
  tool_call_id: string | null
  name: string | null
}

const procs: DaemonProc[] = []
afterAll(() => {
  for (const p of procs) p.kill()
})

function baseEnv(cwd: string, dbPath: string): Record<string, string> {
  return {
    LUME_PROVIDER: 'fake',
    LUME_MODEL: 'fake-model',
    LUME_API_BASE_URL: 'http://localhost:1/v1',
    LUME_CWD: cwd,
    LUME_DB_PATH: dbPath,
  }
}

/** Drive one full scripted turn: permission round-trip -> tool -> verify -> done. */
async function driveScriptedTurn(proc: DaemonProc, content: string): Promise<void> {
  proc.send({ type: 'user_message', content })

  const permission = await proc.waitFor((e) => e.type === 'permission_request')
  expect(permission).toMatchObject({ type: 'permission_request', tool: 'bash' })
  proc.send({
    type: 'permission_response',
    id: (permission as { id: string }).id,
    approve: true,
  })

  await proc.waitFor((e) => e.type === 'tool_completed')

  const verification = await proc.waitFor((e) => e.type === 'verification_completed')
  expect(verification).toMatchObject({ type: 'verification_completed', passed: true })

  const turn = await proc.waitFor((e) => e.type === 'turn_completed')
  expect(turn).toMatchObject({
    type: 'turn_completed',
    final_text: expect.stringContaining('listed'),
  })
}

describe('cross-process session resume (fake provider, SQLite)', () => {
  it('resumes the same session in a second process: seq continues, provider context rebuilds', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-resume-'))
    const dbPath = join(cwd, 'lume.db')
    const captureDir = join(cwd, 'provider-capture')

    // ---- process A: fresh session, one scripted turn -----------------------
    const procA = new DaemonProc(baseEnv(cwd, dbPath))
    procs.push(procA)

    const readyA = await procA.waitFor((e) => e.type === 'ready')
    expect(readyA).toMatchObject({
      type: 'ready',
      protocol_version: 1,
      session_id: expect.any(String),
      model: 'fake-model',
    })
    const sessionId = (readyA as { session_id: string }).session_id

    await driveScriptedTurn(procA, 'list the directory')
    expect(await procA.exit()).toBe(0)

    // ---- process B: same DB file, resume via --session <id> ----------------
    const procB = new DaemonProc(
      { ...baseEnv(cwd, dbPath), LUME_FAKE_CAPTURE_DIR: captureDir },
      ['--mode', 'stream', '--session', sessionId],
    )
    procs.push(procB)

    const readyB = await procB.waitFor((e) => e.type === 'ready')
    // the resumed daemon reuses the SAME session row, not a new one
    expect(readyB).toMatchObject({ type: 'ready', session_id: sessionId })

    await driveScriptedTurn(procB, 'list the directory once more')
    expect(await procB.exit()).toBe(0)

    // ---- store: one session row, 8 messages, continuous seq ----------------
    const db = new Database(dbPath)
    try {
      const sessions = db.prepare('SELECT * FROM sessions').all() as SessionDbRow[]
      expect(sessions).toHaveLength(1) // process B must not have created a session
      expect(sessions[0]).toMatchObject({
        id: sessionId,
        title: 'list the directory', // from A's first message; B must not retitle
        message_count: 8,
        summarized_until_seq: 0, // 8 < threshold 20: nothing summarized yet
      })

      const messages = db
        .prepare('SELECT * FROM messages ORDER BY session_id, seq')
        .all() as MessageDbRow[]
      expect(messages).toHaveLength(8)
      // every message belongs to the single resumed session
      expect([...new Set(messages.map((m) => m.session_id))]).toEqual([sessionId])
      // seq runs 1..8 with no gap, rewind or reuse across the process boundary
      expect(messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(messages.map((m) => m.role)).toEqual([
        'user', 'assistant', 'tool', 'assistant', // process A's turn
        'user', 'assistant', 'tool', 'assistant', // process B's turn
      ])

      // process A's half
      expect(messages[0]).toMatchObject({ role: 'user', content: 'list the directory' })
      const toolCallsA = JSON.parse(messages[1]?.tool_calls ?? 'null') as unknown
      expect(toolCallsA).toEqual([
        { id: 'fake_call_1', name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
      ])
      expect(messages[2]).toMatchObject({
        role: 'tool',
        tool_call_id: 'fake_call_1',
        name: 'bash',
      })
      expect(messages[2]?.content).toContain('lume.db') // the real `ls` ran in cwd
      expect(messages[3]?.content).toBe('Done: I listed the directory (see tool result above).')

      // process B's half (fresh script: same scripted tool call id)
      expect(messages[4]).toMatchObject({
        role: 'user',
        content: 'list the directory once more',
      })
      expect(JSON.parse(messages[5]?.tool_calls ?? 'null') as unknown).toEqual(toolCallsA)
      expect(messages[6]).toMatchObject({
        role: 'tool',
        tool_call_id: 'fake_call_1',
        name: 'bash',
      })
      expect(messages[6]?.content).toContain('lume.db')
      expect(messages[7]?.content).toBe('Done: I listed the directory (see tool result above).')
    } finally {
      db.close()
    }

    // ---- provider context seen by process B's first chat call -------------
    // B consumed its fresh 3-reply script in order: tool call, verify, answer
    expect(await readdir(captureDir)).toEqual(['chat-1.json', 'chat-2.json', 'chat-3.json'])

    const captured = JSON.parse(
      await readFile(join(captureDir, 'chat-1.json'), 'utf8'),
    ) as ChatMessage[]
    // rebuilt system + A's verbatim window (seq 1..4) + B's new user message
    expect(captured).toHaveLength(6)
    expect(captured[0]?.role).toBe('system')
    expect(captured[0]?.content.startsWith(SYSTEM_PROMPT)).toBe(true)
    // no memory sections yet: working memory / summary / recall are all empty
    expect(captured[0]?.content).not.toContain('## User Profile')
    expect(captured[0]?.content).not.toContain('## Conversation So Far')
    expect(captured[0]?.content).not.toContain('## Relevant Long-term Memories')
    expect(captured.slice(1)).toEqual([
      { role: 'user', content: 'list the directory' },
      {
        role: 'assistant',
        content: 'Let me look at the directory.',
        toolCalls: [
          { id: 'fake_call_1', name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
        ],
      },
      {
        role: 'tool',
        content: expect.stringContaining('lume.db'),
        toolCallId: 'fake_call_1',
        name: 'bash',
      },
      { role: 'assistant', content: 'Done: I listed the directory (see tool result above).' },
      { role: 'user', content: 'list the directory once more' },
    ])
  }, 60000)

  it('prints the stored session (id + title) via --list-sessions after the daemon exits', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-list-'))
    const dbPath = join(cwd, 'lume.db')

    const proc = new DaemonProc(baseEnv(cwd, dbPath))
    procs.push(proc)

    const ready = await proc.waitFor((e) => e.type === 'ready')
    const sessionId = (ready as { session_id: string }).session_id
    await driveScriptedTurn(proc, 'list the directory')
    expect(await proc.exit()).toBe(0)

    // one-shot listing against the same DB file
    const list = spawn(process.execPath, [daemonEntry, '--list-sessions'], {
      env: { ...process.env, LUME_DB_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    list.stdout.setEncoding('utf8')
    list.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    list.stderr.setEncoding('utf8')
    list.stderr.on('data', () => {}) // drain
    // 'close' (not 'exit'): guarantees stdout has been fully flushed
    const [code] = (await once(list, 'close')) as [number | null, unknown]
    expect(code).toBe(0)

    const row = stdout.split('\n').find((line) => line.includes(sessionId))
    expect(row).toBeDefined()
    expect(row).toContain('list the directory') // derived title of A's first message
    expect(row).toMatch(/\s+4$/) // MSGS column: one scripted turn = 4 messages
  }, 60000)
})
