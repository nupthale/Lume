import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config/config.js'
import { Agent } from '../src/core/agent.js'
import type { Frontend } from '../src/core/frontend.js'
import { PermissionPolicy } from '../src/core/permission.js'
import { findCutoff, Summarizer } from '../src/memory/summarizer.js'
import type { MessageRole, MessageRow, SessionRow } from '../src/memory/store.js'
import { SqliteStore } from '../src/memory/store.js'
import type { FakeReply } from '../src/providers/fake.js'
import { FakeProvider } from '../src/providers/fake.js'
import type { AssistantReply, ChatMessage } from '../src/providers/types.js'
import { ToolRegistry } from '../src/tools/registry.js'
import type { Logger } from '../src/util/logger.js'
import { ulid } from '../src/util/ulid.js'

/** Logger stub recording warnings so tests can assert on the failure path */
function makeLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = []
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg) => {
      warnings.push(msg)
    },
    error: () => {},
  }
  return { logger, warnings }
}

function makeStore(): { store: SqliteStore; session: SessionRow } {
  const store = new SqliteStore(':memory:')
  const session = store.createSession({ id: ulid(), cwd: '/tmp', model: 'test-model' })
  return { store, session }
}

function row(seq: number, role: MessageRole, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    sessionId: 's',
    seq,
    role,
    content: `m${seq}`,
    toolCalls: null,
    toolCallId: null,
    name: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function reply(partial: Partial<AssistantReply>): AssistantReply {
  return { content: '', reasoning: '', toolCalls: [], finishReason: 'stop', ...partial }
}

const TOOL_CALLS = JSON.stringify([{ id: 'c1', name: 'bash', arguments: '{"command":"ls"}' }])

describe('findCutoff', () => {
  it('returns the maximal internal boundary across multiple turns', () => {
    const rows = [
      row(1, 'user'),
      row(2, 'assistant'),
      row(3, 'user'),
      row(4, 'assistant'),
      row(5, 'user'),
      row(6, 'assistant'),
    ]
    // boundaries after seq 2 and seq 4 both legal; the last turn (5-6) stays verbatim
    expect(findCutoff(rows)).toBe(4)
  })

  it('never splits an assistant(tool_calls) -> tool pair', () => {
    const rows = [
      row(1, 'user'),
      row(2, 'assistant', { toolCalls: TOOL_CALLS }),
      row(3, 'tool', { toolCallId: 'c1', name: 'bash' }),
      row(4, 'assistant'),
      row(5, 'user'),
      row(6, 'assistant'),
    ]
    // cutting after the tool-calling assistant (2) would orphan the tool
    // result; the maximal legal boundary is the completed turn at 4
    expect(findCutoff(rows)).toBe(4)
  })

  it('keeps an in-flight tool cycle out of the cut when nothing follows it', () => {
    const rows = [
      row(1, 'user'),
      row(2, 'assistant'),
      row(3, 'user'),
      row(4, 'assistant', { toolCalls: TOOL_CALLS }),
      row(5, 'tool', { toolCallId: 'c1', name: 'bash' }),
    ]
    // the tool pair (4-5) must stay together in the verbatim window
    expect(findCutoff(rows)).toBe(2)
  })

  it('returns null for degenerate sequences without a legal boundary', () => {
    // user-after-user never forms a boundary; the trailing assistant has no successor turn
    expect(
      findCutoff([row(1, 'user'), row(2, 'user'), row(3, 'user'), row(4, 'assistant')]),
    ).toBeNull()
    // in-flight tool cycle with no completed turn after it
    expect(
      findCutoff([row(1, 'user'), row(2, 'assistant', { toolCalls: TOOL_CALLS }), row(3, 'tool')]),
    ).toBeNull()
    expect(findCutoff([])).toBeNull()
  })

  it('keeps a single turn in the verbatim window', () => {
    expect(findCutoff([row(1, 'user'), row(2, 'assistant')])).toBeNull()
  })
})

describe('Summarizer.maybeCompress', () => {
  /**
   * Three turns, the first including a tool cycle:
   * seq 1-4 = turn 1 (user, assistant w/ tool_calls, tool, final assistant),
   * seq 5-6 = turn 2, seq 7-8 = turn 3. Maximal legal boundary: seq 6.
   */
  function seedDialogue(store: SqliteStore, sessionId: string): void {
    store.appendMessage({ sessionId, role: 'user', content: 'q1' })
    store.appendMessage({
      sessionId,
      role: 'assistant',
      content: 'checking',
      toolCalls: [{ id: 'c1', name: 'bash', arguments: '{"command":"ls"}' }],
    })
    store.appendMessage({ sessionId, role: 'tool', content: 'file-a', toolCallId: 'c1', name: 'bash' })
    store.appendMessage({ sessionId, role: 'assistant', content: 'final answer 1' })
    store.appendMessage({ sessionId, role: 'user', content: 'q2' })
    store.appendMessage({ sessionId, role: 'assistant', content: 'answer 2' })
    store.appendMessage({ sessionId, role: 'user', content: 'q3' })
    store.appendMessage({ sessionId, role: 'assistant', content: 'answer 3' })
  }

  it('advances the summary and watermark to the maximal safe boundary', async () => {
    const { store, session } = makeStore()
    seedDialogue(store, session.id)
    const { logger } = makeLogger()
    const summarizer = new Summarizer({
      provider: new FakeProvider([reply({ content: '  merged summary  ' })]),
      store,
      logger,
    })

    await summarizer.maybeCompress(session.id, 4) // 8 unsummarized > 4

    const updated = store.getSession(session.id)
    expect(updated?.summary).toBe('merged summary') // trimmed
    expect(updated?.summarizedUntilSeq).toBe(6)
    expect(store.getUnsummarizedCount(session.id)).toBe(2)
    // no overlap: the verbatim window starts strictly above the watermark
    const window = store.getMessages(session.id, { afterSeq: updated?.summarizedUntilSeq ?? 0 })
    expect(window.map((r) => r.seq)).toEqual([7, 8])
    expect(window.map((r) => r.content)).toEqual(['q3', 'answer 3'])
    // append-only: all 8 messages are still in the store
    expect(store.getMessages(session.id)).toHaveLength(8)
  })

  it('feeds the old summary and the new transcript into an incremental merge', async () => {
    const { store, session } = makeStore()
    seedDialogue(store, session.id)
    store.updateSession(session.id, { summary: 'old summary', summarizedUntilSeq: 2 })
    let seen: ChatMessage[] | undefined
    const summarizer = new Summarizer({
      provider: new FakeProvider([
        (messages) => {
          seen = [...messages]
          return reply({ content: 'new merged summary' })
        },
      ]),
      store,
      logger: makeLogger().logger,
    })

    await summarizer.maybeCompress(session.id, 4) // 6 above the old watermark > 4

    expect(seen?.map((m) => m.role)).toEqual(['system', 'user'])
    const user = seen?.[1]?.content ?? ''
    expect(user).toContain('old summary')
    expect(user).toContain('q2') // messages above the old watermark are in the transcript
    expect(user).not.toContain('q3') // above the cut (6): stays verbatim
    expect(store.getSession(session.id)).toMatchObject({
      summary: 'new merged summary',
      summarizedUntilSeq: 6,
    })
  })

  it('leaves the watermark and summary untouched when the LLM call fails', async () => {
    const { store, session } = makeStore()
    seedDialogue(store, session.id)
    store.updateSession(session.id, { summary: 'old summary', summarizedUntilSeq: 2 })
    const { logger, warnings } = makeLogger()
    const summarizer = new Summarizer({ provider: new FakeProvider([]), store, logger }) // script exhausted -> chat throws

    await summarizer.maybeCompress(session.id, 4)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('summarization failed')
    expect(store.getSession(session.id)).toMatchObject({
      summary: 'old summary',
      summarizedUntilSeq: 2,
    })
    expect(store.getUnsummarizedCount(session.id)).toBe(6)
    expect(store.getMessages(session.id)).toHaveLength(8) // nothing lost
  })

  it('does not call the provider at or below the threshold', async () => {
    const { store, session } = makeStore()
    seedDialogue(store, session.id)
    const { logger, warnings } = makeLogger()
    const summarizer = new Summarizer({ provider: new FakeProvider([]), store, logger })

    await summarizer.maybeCompress(session.id, 8) // count == threshold
    await summarizer.maybeCompress(session.id, 20) // count < threshold

    expect(warnings).toHaveLength(0) // provider never called
    expect(store.getSession(session.id)).toMatchObject({ summary: '', summarizedUntilSeq: 0 })
  })

  it('retries next turn when no legal boundary exists yet', async () => {
    const { store, session } = makeStore()
    // one long tool cycle in flight: user, assistant(tool_calls), tool — no completed turn boundary
    store.appendMessage({ sessionId: session.id, role: 'user', content: 'q1' })
    store.appendMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'checking',
      toolCalls: [{ id: 'c1', name: 'bash', arguments: '{}' }],
    })
    store.appendMessage({
      sessionId: session.id,
      role: 'tool',
      content: 'out',
      toolCallId: 'c1',
      name: 'bash',
    })
    const { logger, warnings } = makeLogger()
    const summarizer = new Summarizer({ provider: new FakeProvider([]), store, logger })

    await summarizer.maybeCompress(session.id, 1) // 3 > 1, but no safe cut

    expect(warnings).toHaveLength(0) // provider never called
    expect(store.getSession(session.id)).toMatchObject({ summary: '', summarizedUntilSeq: 0 })
    expect(store.getUnsummarizedCount(session.id)).toBe(3)
  })
})

describe('Agent memory mode: end-of-turn compression (integration)', () => {
  function makeConfig(overrides: Record<string, unknown> = {}) {
    return ConfigSchema.parse({
      apiBaseUrl: 'http://localhost:1/v1',
      model: 'test-model',
      cwd: '/tmp',
      summarizeThreshold: 3,
      ...overrides,
    })
  }

  it('summarizes above the threshold and rebuilds the next turn from the new watermark', async () => {
    const { store, session } = makeStore()
    let thirdTurnMessages: ChatMessage[] | undefined
    let secondCompressionMessages: ChatMessage[] | undefined
    const script: FakeReply[] = [
      reply({ content: 'first answer' }), // turn 1 reply
      reply({ content: 'second answer' }), // turn 2 reply
      reply({ content: 'summary of turn one' }), // compression after turn 2 (4 msgs > threshold 3)
      (messages) => {
        // turn 3: rebuilt context must show the rolling summary + new window
        thirdTurnMessages = [...messages]
        return reply({ content: 'third answer' })
      },
      (messages) => {
        // compression after turn 3: incremental merge of the old summary + turn 2
        secondCompressionMessages = [...messages]
        return reply({ content: 'summary of turns one and two' })
      },
    ]
    const provider = new FakeProvider(script)
    const { logger, warnings } = makeLogger()
    const agent = new Agent({
      provider,
      tools: new ToolRegistry(),
      policy: new PermissionPolicy(),
      config: makeConfig(),
      logger,
      memory: { store, session },
    })
    const events: unknown[] = []
    agent.attachFrontend({
      emit: (e) => events.push(e),
      requestPermission: async () => false,
    } satisfies Frontend)

    const runTurn = async (content: string): Promise<void> => {
      agent.submit(content)
      while (agent.isBusy) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    await runTurn('first question') // 2 msgs <= 3: no compression
    await runTurn('second question') // 4 msgs > 3: compress seq 1-2, watermark -> 2
    await runTurn('third question') // 4 msgs > 3: incremental compress seq 3-4, watermark -> 4

    // turn 3 provider view: system with rolling summary, verbatim window from the new watermark
    expect(thirdTurnMessages?.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(thirdTurnMessages?.[1]).toEqual({ role: 'user', content: 'second question' })
    expect(thirdTurnMessages?.[2]).toEqual({ role: 'assistant', content: 'second answer' })
    expect(thirdTurnMessages?.[3]).toEqual({ role: 'user', content: 'third question' })
    const system = thirdTurnMessages?.[0]?.content ?? ''
    expect(system).toContain('## Conversation So Far (rolling summary)')
    expect(system).toContain('summary of turn one')
    // summarized messages never re-enter the verbatim window
    expect(thirdTurnMessages?.some((m) => m.content.includes('first question'))).toBe(false)
    expect(thirdTurnMessages?.some((m) => m.content.includes('first answer'))).toBe(false)

    // the second compression merged the old summary with the newly cut turn
    expect(secondCompressionMessages?.map((m) => m.role)).toEqual(['system', 'user'])
    expect(secondCompressionMessages?.[1]?.content).toContain('summary of turn one')
    expect(secondCompressionMessages?.[1]?.content).toContain('second question')
    expect(secondCompressionMessages?.[1]?.content).not.toContain('third question')

    // store state: watermark advanced twice, unsummarized shrank, append-only preserved
    expect(store.getSession(session.id)).toMatchObject({
      summary: 'summary of turns one and two',
      summarizedUntilSeq: 4,
    })
    expect(store.getUnsummarizedCount(session.id)).toBe(2)
    expect(store.getMessages(session.id).map((r) => r.content)).toEqual([
      'first question',
      'first answer',
      'second question',
      'second answer',
      'third question',
      'third answer',
    ])
    // no unexpected summarization failures on any exit path
    expect(warnings).toHaveLength(0)
  })
})
