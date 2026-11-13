import type { Config } from '../config/config.js'
import {
  SYSTEM_PROMPT,
  envPromptSection,
  memoryPromptSections,
  skillsPromptSection,
  todosPromptSection,
} from '../core/prompts.js'
import type { ChatMessage } from '../providers/types.js'
import { toChatMessage } from './mapping.js'
import type { MemoryStore } from './store.js'

/**
 * Turn-start context assembly (memory mode): rebuild the message history from
 * the store instead of accumulating an in-memory array across turns.
 *
 * The system message is recomposed from the latest session row, so the
 * rolling summary / watermark (advanced by the Task 4 compressor) and the
 * working memory (updated by the update_working_memory tool) take effect on
 * the very next turn. The verbatim window holds the newest contextK messages
 * strictly above the watermark, so a message never appears both in the
 * summary and verbatim.
 *
 * `semanticRecall` is the Layer 3 block: pre-formatted "- <fact>" lines the
 * caller recalled against the latest user message. Default '' keeps existing
 * callers (and sessions without an embedder) free of any recall section.
 */
export function buildTurnContext(
  store: MemoryStore,
  sessionId: string,
  config: Pick<Config, 'contextK'>,
  skillsList: Array<{ name: string; description: string }>,
  semanticRecall: string = '',
  cwd: string = '',
): ChatMessage[] {
  const session = store.getSession(sessionId)
  if (session === null) {
    throw new Error(`buildTurnContext: session not found: ${sessionId}`)
  }
  const system: ChatMessage = {
    role: 'system',
    content:
      SYSTEM_PROMPT +
      envPromptSection(cwd) +
      skillsPromptSection(skillsList) +
      todosPromptSection(store.listTodos()) +
      memoryPromptSections({
        workingMemory: session.workingMemory,
        summary: session.summary,
        semanticRecall, // Layer 3 recall, filled by the agent when an embedder is configured
      }),
  }
  const window = repairToolPairing(
    store
      .getMessages(sessionId, { afterSeq: session.summarizedUntilSeq, limit: config.contextK })
      .map(toChatMessage),
  )
  return [system, ...window]
}

/**
 * Ensure every assistant tool_calls message is followed by a tool response for
 * each call id, and drop orphan tool messages whose requesting assistant fell
 * outside the window (K-trim edge). Sessions written before the abort-repair
 * fix (or killed mid-tool-cycle) can contain unpaired tool calls; qwen3
 * hallucinates results for them, so assembly injects synthetic empty results.
 * Pure and idempotent: an already-valid window passes through untouched.
 */
export function repairToolPairing(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  /** call ids whose requesting assistant is inside the window */
  const known = new Set<string>()
  for (let i = 0; i < messages.length; i += 1) {
    const msg: ChatMessage | undefined = messages[i]
    if (msg === undefined) continue
    if (msg.role === 'assistant' && msg.toolCalls !== undefined) {
      for (const c of msg.toolCalls) known.add(c.id)
    }
    if (msg.role === 'tool' && msg.toolCallId !== undefined && !known.has(msg.toolCallId)) {
      continue // orphan tool result: its assistant was trimmed out of the window
    }
    out.push(msg)
    if (msg.role !== 'assistant' || msg.toolCalls === undefined) continue

    const answered = new Set<string>()
    let j = i + 1
    while (j < messages.length && messages[j]?.role === 'tool') {
      const tool = messages[j]
      if (tool === undefined) break
      if (tool.toolCallId !== undefined) answered.add(tool.toolCallId)
      if (tool.toolCallId !== undefined && !known.has(tool.toolCallId)) {
        j += 1
        continue // orphan; dropped
      }
      out.push(tool)
      j += 1
    }
    const missing = (msg.toolCalls ?? []).filter((c) => !answered.has(c.id))
    for (const call of missing) {
      out.push({
        role: 'tool',
        content: '(no result was produced for this tool call)',
        toolCallId: call.id,
        name: call.name,
      })
    }
    i = j - 1
  }
  return out
}
