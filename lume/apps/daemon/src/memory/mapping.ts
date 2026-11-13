import type { ChatMessage, ToolCallPayload } from '../providers/types.js'
import type { AppendMessageInput, MessageRole, MessageRow } from './store.js'

/**
 * Message mapping between provider ChatMessages and stored MessageRows.
 *
 * system messages never touch the store: the system prompt is rebuilt each
 * turn from the fixed text plus the skill inventory and memory sections, so
 * the persisted roles are exactly user/assistant/tool. PersistableChatMessage
 * encodes that rule at the type level: system cannot be passed to
 * toStoredMessage in the first place.
 */

/** ChatMessage narrowed to the persistable roles (no system). */
export type PersistableChatMessage = ChatMessage & { role: MessageRole }

/** ChatMessage -> append-only storage input. toolCalls stays a live array; the store JSON-encodes it. */
export function toStoredMessage(sessionId: string, msg: PersistableChatMessage): AppendMessageInput {
  const input: AppendMessageInput = { sessionId, role: msg.role, content: msg.content }
  if (msg.toolCalls !== undefined) input.toolCalls = msg.toolCalls
  if (msg.toolCallId !== undefined) input.toolCallId = msg.toolCallId
  if (msg.name !== undefined) input.name = msg.name
  return input
}

/** Stored row -> provider ChatMessage. Corrupted tool_calls JSON degrades to a plain message. */
export function toChatMessage(row: MessageRow): ChatMessage {
  const role = row.role
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
    throw new Error(`toChatMessage: unexpected stored message role "${String(role)}"`)
  }
  const msg: ChatMessage = { role, content: row.content }
  if (row.toolCalls !== null) {
    try {
      const parsed: unknown = JSON.parse(row.toolCalls)
      if (Array.isArray(parsed)) msg.toolCalls = parsed as ToolCallPayload[]
    } catch {
      // corrupted tool_calls JSON: degrade to a plain assistant message
    }
  }
  if (row.toolCallId !== null) msg.toolCallId = row.toolCallId
  if (row.name !== null) msg.name = row.name
  return msg
}
