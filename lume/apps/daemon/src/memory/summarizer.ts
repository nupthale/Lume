import type { Logger } from '../util/logger.js'
import { aggregateStream, type ChatMessage, type LlmProvider } from '../providers/types.js'
import { toChatMessage } from './mapping.js'
import type { MemoryStore, MessageRow } from './store.js'

/**
 * Layer 2 incremental compressor: rolling summary + watermark advance.
 *
 * Called at the end of every memory-mode turn. When the unsummarized message
 * count exceeds the threshold, the messages between the watermark and the
 * maximal SAFE turn boundary are folded into the session's rolling summary
 * and the watermark advances in a single session patch.
 *
 * Hard constraints honored here:
 * - the cut only lands on legal turn boundaries: never between a
 *   user/assistant pair, and never between an assistant(tool_calls) and its
 *   tool result (the last turn always stays in the verbatim window)
 * - a failed summarization LLM call skips compression entirely: the watermark
 *   does not move, no data is lost, and the next turn retries naturally
 * - summarization failure must never surface in the turn event stream; the
 *   caller still keeps its own backstop for non-LLM crashes (e.g. store)
 */

/**
 * True when the stored assistant message carries live tool calls. Corrupted
 * JSON degrades to "no tool calls", mirroring toChatMessage's degradation: a
 * message that cannot be restored as tool-calling must not gate the cut.
 */
function hasToolCalls(row: MessageRow): boolean {
  if (row.toolCalls === null) return false
  try {
    const parsed: unknown = JSON.parse(row.toolCalls)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

/**
 * Maximal legal summarization cutoff for the unsummarized messages (ascending
 * seq, above the watermark), or null when none exists yet.
 *
 * A legal boundary sits after an assistant message that ended its turn (no
 * tool calls) AND is followed by a later user turn — so the final turn of
 * the window is never summarized away. Degenerate sequences (user after
 * user, in-flight tool cycles) yield no boundary and are skipped
 * conservatively.
 *
 * Returns the seq of the boundary message (the value the watermark advances
 * to); ascending input guarantees the last boundary found is the maximal one.
 */
export function findCutoff(messages: MessageRow[]): number | null {
  let cut: number | null = null
  for (let i = 0; i + 1 < messages.length; i++) {
    const candidate = messages[i]
    const next = messages[i + 1]
    if (candidate === undefined || next === undefined) continue
    if (candidate.role !== 'assistant') continue
    if (hasToolCalls(candidate)) continue // cutting here would orphan the tool result
    if (next.role !== 'user') continue // nothing follows: the last turn stays verbatim
    cut = candidate.seq
  }
  return cut
}

const SUMMARY_SYSTEM_PROMPT =
  'You maintain the rolling summary of a software engineering conversation. ' +
  'Merge the existing summary (when provided) with the new messages into one updated summary. ' +
  'Keep only what matters for continuing the work: decisions made, changes to the codebase or ' +
  'environment, unfinished or follow-up items, and key conclusions. ' +
  'Drop greetings, small talk, restatements, and stable user-profile facts — the user profile ' +
  'is maintained separately. Write a single compact paragraph. Reply with the summary text only.'

const SUMMARY_MAX_TOKENS = 800

/** Compact one-message-per-line transcript for the summarization prompt. */
function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'tool') {
        const label = m.name === undefined ? 'tool' : `tool ${m.name}`
        return `${label}: ${m.content}`
      }
      if (m.role === 'assistant' && m.toolCalls !== undefined && m.toolCalls.length > 0) {
        const names = m.toolCalls.map((tc) => tc.name).join(', ')
        return m.content === '' ? `assistant (called ${names})` : `assistant (called ${names}): ${m.content}`
      }
      return `${m.role}: ${m.content}`
    })
    .join('\n')
}

export interface SummarizerDeps {
  provider: LlmProvider
  store: MemoryStore
  logger: Logger
}

export class Summarizer {
  constructor(private readonly deps: SummarizerDeps) {}

  /**
   * Fold the summarizable messages into the rolling summary when the
   * unsummarized count exceeds `threshold`. All failures are contained: a
   * provider error or empty result leaves the session untouched so the next
   * turn retries.
   *
   * Concurrency: invoked at turn end while the agent still holds its turn
   * slot, and the agent is single-threaded — no new message can land between
   * the snapshot and the watermark patch, so no locking is needed.
   */
  async maybeCompress(sessionId: string, threshold: number): Promise<void> {
    const { provider, store, logger } = this.deps

    const count = store.getUnsummarizedCount(sessionId)
    if (count <= threshold) return

    const session = store.getSession(sessionId)
    if (session === null) return

    const rows = store.getMessages(sessionId, { afterSeq: session.summarizedUntilSeq })
    const cut = findCutoff(rows)
    if (cut === null) return // no safe boundary yet; retry next turn

    const transcript = renderTranscript(rows.filter((r) => r.seq <= cut).map(toChatMessage))
    const userContent =
      session.summary === ''
        ? `New messages to summarize:\n${transcript}`
        : `Existing summary:\n${session.summary}\n\nNew messages to merge in:\n${transcript}`

    let summary: string
    try {
      const reply = await aggregateStream(
        provider.chat({
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          maxTokens: SUMMARY_MAX_TOKENS,
        }),
      )
      summary = reply.content.trim()
    } catch (err) {
      logger.warn('summarization failed; watermark unchanged, will retry next turn', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (summary === '') {
      logger.warn('summarization produced empty output; watermark unchanged', { sessionId })
      return
    }

    // single patch: summary and watermark advance together, no intermediate state
    store.updateSession(sessionId, { summary, summarizedUntilSeq: cut })
  }
}
