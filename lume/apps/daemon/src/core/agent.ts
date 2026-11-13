import type { Config } from '../config/config.js'
import { buildTurnContext } from '../memory/context.js'
import type { EmbeddingClient } from '../memory/embedding.js'
import { type PersistableChatMessage, toStoredMessage } from '../memory/mapping.js'
import { recallFacts } from '../memory/semantic.js'
import { deriveTitle } from '../memory/session.js'
import type { MemoryStore, SessionRow } from '../memory/store.js'
import { Summarizer } from '../memory/summarizer.js'
import {
  type ChatMessage,
  type LlmProvider,
  type ToolCallPayload,
  ProviderError,
  aggregateStream,
} from '../providers/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import { shortId } from '../util/id.js'
import type { Logger } from '../util/logger.js'
import { TurnAbortedError } from './errors.js'
import { createTurnEvents } from './events.js'
import { type Frontend, makeEventSink } from './frontend.js'
import { Harness } from './harness.js'
import type { PermissionPolicy } from './permission.js'
import {
  SYSTEM_PROMPT,
  envPromptSection,
  skillsPromptSection,
} from './prompts.js'
import type { SkillIndex } from '../skills/skills.js'

/**
 * Agent: the turn loop.
 *
 * Per turn: stream an assistant reply; if it requests tools, run each call
 * through the Harness micro cycle (review -> act -> verify), then loop so the
 * model can react to tool results. When no tools are requested the turn ends.
 * A loop-limit guard forces a final tool-free answer when exceeded.
 *
 * Lifecycle discipline: the agent never touches the terminal and never exits
 * the process. All output goes through the Frontend; process exit is driven
 * by the skin.
 */
export class Agent {
  private history: ChatMessage[]
  private readonly harness: Harness
  /** end-of-turn incremental compressor; null when memory mode is off */
  private readonly summarizer: Summarizer | null
  private sink: (e: Parameters<Frontend['emit']>[0]) => void = () => {
    throw new Error('Agent used before attachFrontend()')
  }

  private busy = false
  private readonly queue: string[] = []
  private currentAbort: AbortController | null = null
  private currentTurnId: string | null = null
  private stopping = false
  /** in-flight turn pump; settles once the queue drains (incl. post-turn summarization) */
  private pumpTask: Promise<void> | null = null

  constructor(
    private readonly deps: {
      provider: LlmProvider
      tools: ToolRegistry
      policy: PermissionPolicy
      config: Config
      logger: Logger
      /** skill discovery; omitted in tests without skills */
      skills?: SkillIndex
      /** layered session memory; omitted in tests without memory */
      memory?: { store: MemoryStore; session: SessionRow }
      /** embedding client for Layer 3 semantic recall; unset disables Layer 3 */
      embedder?: EmbeddingClient
    },
  ) {
    this.history = [{ role: 'system', content: SYSTEM_PROMPT }]
    this.harness = new Harness(deps)
    this.summarizer =
      deps.memory === undefined
        ? null
        : new Summarizer({ provider: deps.provider, store: deps.memory.store, logger: deps.logger })
  }

  get modelName(): string {
    return this.deps.config.model
  }

  /**
   * Bind the frontend. Skins call this after constructing the agent because
   * the frontend (and its permission suspension machinery) is skin-specific.
   */
  attachFrontend(frontend: Frontend): void {
    this.sink = makeEventSink(frontend)
    this.harness.rebindFrontend(frontend)
  }

  get isBusy(): boolean {
    return this.busy
  }

  /** Submit a user message. Queued when a turn is in flight. */
  submit(content: string): void {
    if (this.stopping) return
    if (this.busy) {
      this.queue.push(content)
      this.sink({ type: 'user_message_queued', queue_length: this.queue.length })
      return
    }
    this.pumpTask = this.pump(content)
  }

  /**
   * Abort the current turn (no-op when idle). `turnId` optionally targets a
   * specific turn. Pending permission suspensions are released by the skin.
   */
  interrupt(turnId?: string): void {
    if (this.currentAbort === null) return
    if (turnId !== undefined && turnId !== this.currentTurnId) return
    this.currentAbort.abort()
  }

  /** Stop the agent: aborts the in-flight turn and drains without new work. */
  stop(): void {
    this.stopping = true
    this.queue.length = 0
    if (this.currentAbort !== null) this.currentAbort.abort()
  }

  /**
   * Wait until no turn is in flight, including the end-of-turn summarization
   * in runTurn's finally. The shutdown path must await this before closing the
   * store: the post-turn compressor calls the provider AFTER the turn's
   * completed event, and store.close() under it loses the summary.
   */
  async idle(): Promise<void> {
    if (this.pumpTask !== null) await this.pumpTask
  }

  private async pump(firstContent: string): Promise<void> {
    let content: string | undefined = firstContent
    while (content !== undefined && !this.stopping) {
      try {
        await this.runTurn(content)
      } catch (err) {
        // runTurn handles its own failure events; this is a hard backstop
        this.deps.logger.error('turn crashed', { error: String(err) })
        this.sink({
          type: 'error',
          error: {
            code: 'internal_error',
            message: err instanceof Error ? err.message : String(err),
          },
          fatal: false,
        })
      }
      content = this.queue.shift()
    }
  }

  /**
   * Rescan skill directories and return the current skill inventory. Cheap
   * (frontmatter only); skills added mid-session are picked up on the next
   * turn. A broken scan degrades to "no skills" rather than failing the turn.
   */
  private async refreshSkills(): Promise<Array<{ name: string; description: string }>> {
    const skills = this.deps.skills
    if (skills === undefined) return []
    try {
      return await skills.refresh()
    } catch (err) {
      this.deps.logger.warn('skill scan failed', { error: err instanceof Error ? err.message : String(err) })
      return []
    }
  }

  /**
   * Title the session from its first user message: only while the title is
   * still empty, so resumed sessions keep their existing title.
   */
  private maybeSetSessionTitle(userContent: string): void {
    const memory = this.deps.memory
    if (memory === undefined || memory.session.title !== '') return
    const title = deriveTitle(userContent)
    if (title === '') return
    memory.store.updateSession(memory.session.id, { title })
    memory.session.title = title
  }

  /**
   * Append a message to the history and, in memory mode, mirror it into the
   * store (append-only; the store allocates the seq).
   */
  private pushMessage(msg: PersistableChatMessage): void {
    this.history.push(msg)
    const memory = this.deps.memory
    if (memory !== undefined) {
      memory.store.appendMessage(toStoredMessage(memory.session.id, msg))
    }
  }

  /**
   * Layer 3 semantic recall: embed the turn's user message and fetch the
   * top-k similar long-term facts as "- <fact>" lines. Empty when no embedder
   * is configured (Layer 3 fully disabled) or nothing scores above the
   * threshold. Recall failures are logged and swallowed: a broken embedding
   * backend degrades the turn to recall-free, it never breaks the turn.
   */
  private async recallSemanticFacts(userContent: string): Promise<string> {
    const { embedder, memory, logger } = this.deps
    if (embedder === undefined || memory === undefined) return ''
    try {
      const facts = await recallFacts({ embedder, store: memory.store }, userContent)
      if (facts.length === 0) return ''
      return facts.map((fact) => `- ${fact}`).join('\n')
    } catch (err) {
      logger.warn('semantic recall failed; continuing without it', {
        error: err instanceof Error ? err.message : String(err),
      })
      return ''
    }
  }

  private async runTurn(userContent: string): Promise<void> {
    const { provider, tools, config, logger } = this.deps
    const memory = this.deps.memory
    const turnId = shortId('turn')
    const abort = new AbortController()
    this.currentAbort = abort
    this.currentTurnId = turnId
    this.busy = true

    const events = createTurnEvents(this.sink, turnId)
    events.started()
    const skillsList = await this.refreshSkills()
    this.maybeSetSessionTitle(userContent)

    if (memory === undefined) {
      // plain mode: history accumulates across turns; refresh the system message in place
      this.history[0] = {
        role: 'system',
        content: SYSTEM_PROMPT + envPromptSection(config.cwd) + skillsPromptSection(skillsList),
      }
    } else {
      // memory mode: rebuild the whole context from the store (fresh session
      // state + verbatim window above the summary watermark); the system block
      // is prefixed with the Layer 3 recall for this turn's user message
      const semanticRecall = await this.recallSemanticFacts(userContent)
      this.history = buildTurnContext(
        memory.store,
        memory.session.id,
        config,
        skillsList,
        semanticRecall,
        config.cwd,
      )
    }

    this.pushMessage({ role: 'user', content: userContent })

    // tool calls of the current reply that have not received a tool message
    // yet; used by the catch block to repair the transcript on abort/failure
    let unresolved: ToolCallPayload[] = []

    try {
      let loops = 0
      for (;;) {
        const toolsAllowed = loops < config.maxToolLoopsPerTurn

        if (!toolsAllowed) {
          this.pushMessage({
            role: 'user',
            content:
              'The tool-call loop limit was reached. Answer the user directly now; ' +
              'do not call any more tools.',
          })
        }

        const messageId = shortId('msg')
        events.messageStarted(messageId)

        let reply: Awaited<ReturnType<typeof aggregateStream>>
        try {
          reply = await aggregateStream(
            provider.chat({
              messages: this.history,
              ...(toolsAllowed ? { tools: tools.getSchemas() } : {}),
              signal: abort.signal,
            }),
            {
              onTextDelta: (delta) => events.delta(messageId, delta),
              onReasoningDelta: (delta) => events.thoughtDelta(messageId, delta),
            },
          )
        } catch (err) {
          events.messageCompleted(messageId)
          throw err
        }
        events.messageCompleted(messageId, reply.finishReason)

        if (reply.reasoning.length > 0) events.thought(reply.reasoning)
        this.pushMessage({
          role: 'assistant',
          content: reply.content,
          ...(reply.toolCalls.length > 0 ? { toolCalls: reply.toolCalls } : {}),
        })

        if (reply.toolCalls.length === 0) {
          events.completed(reply.content)
          return
        }

        // run each requested tool through the harness micro cycle; `unresolved`
        // tracks calls that never received a tool message (interrupted mid-cycle)
        const verifications: Array<{ passed: boolean; note?: string }> = []
        unresolved = [...reply.toolCalls]
        for (const call of reply.toolCalls) {
          const result = await this.harness.runToolCall(
            {
              turnId,
              signal: abort.signal,
              events,
              history: this.history,
              // memory mode: mirror the tool result message into the store;
              // the harness keeps pushing this.history itself
              ...(memory !== undefined
                ? {
                    onMessage: (msg: PersistableChatMessage) =>
                      memory.store.appendMessage(toStoredMessage(memory.session.id, msg)),
                  }
                : {}),
            },
            call,
          )
          unresolved = unresolved.filter((c) => c.id !== call.id)
          if (result.verification !== undefined) verifications.push(result.verification)
        }

        // failed verifications feed back into the next iteration for self-correction
        const failed = verifications.filter((v) => !v.passed)
        if (failed.length > 0) {
          this.pushMessage({
            role: 'user',
            content: `Some tool results failed verification. Reassess and correct your approach: ${failed.map((v) => v.note ?? '(no note)').join(' | ')}`,
          })
        }

        loops++
      }
    } catch (err) {
      // transcript repair: close any unanswered tool calls, then close the
      // dangling user message, so the persisted window never contains an
      // assistant tool_calls message without its tool responses (qwen3
      // hallucinates results for those) nor a user message without a reply
      const repairTranscript = (placeholder: string): void => {
        for (const call of unresolved) {
          this.pushMessage({
            role: 'tool',
            content: '(tool call was interrupted; no result was produced)',
            toolCallId: call.id,
            name: call.name,
          })
        }
        this.pushMessage({ role: 'assistant', content: placeholder })
      }
      if (err instanceof TurnAbortedError || abort.signal.aborted) {
        repairTranscript('(turn aborted by user)')
        events.failed('aborted', 'aborted', 'turn aborted by user')
        return
      }
      if (err instanceof ProviderError) {
        const code = err.timeout ? 'provider_timeout' : 'provider_error'
        repairTranscript('(turn failed: no response was produced)')
        events.failed('failed', code, err.message)
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      logger.error('turn failed', { turnId, error: message })
      repairTranscript('(turn failed: no response was produced)')
      events.failed('failed', 'internal_error', message)
    } finally {
      // memory mode: incremental compression at turn end, while the turn slot
      // is still held (the agent is single-threaded, so no new message can
      // land mid-compression). Runs on every exit path — aborted/failed turns
      // included; findCutoff only advances to safe turn boundaries. The
      // compressor swallows LLM failures itself; this backstop keeps any
      // residual crash out of the turn event stream.
      if (this.summarizer !== null && memory !== undefined) {
        try {
          await this.summarizer.maybeCompress(memory.session.id, config.summarizeThreshold)
        } catch (err) {
          logger.error('post-turn summarization crashed', {
            turnId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      this.busy = false
      this.currentAbort = null
      this.currentTurnId = null
    }
  }
}
