import { z } from 'zod'
import { type ToolDefinition, ToolError } from '../tools/types.js'
import type { MemoryStore, SessionRow } from './store.js'

/**
 * Hard cap for the working-memory profile: it is re-injected into the system
 * prompt every turn, so it must stay small (a few hundred tokens at most).
 */
export const WORKING_MEMORY_MAX_CHARS = 2000

/**
 * update_working_memory: Layer 1 working memory.
 *
 * Maintains a small cross-turn profile of the user (preferences, project
 * context, current goals). Each call REPLACES the whole profile, so the model
 * must carry over the existing content (visible under "## User Profile" in
 * the system prompt) with its changes instead of storing a chat transcript.
 *
 * The 2000-char cap rejects rather than silently truncates: the model sees
 * the error as a tool result and gets a chance to converge on its own.
 *
 * risk: read -> auto-approved by the permission policy (the profile only
 * shapes future prompts; it never touches the user's filesystem).
 */
export function makeUpdateWorkingMemoryTool(
  memory: { store: MemoryStore; session: SessionRow },
): ToolDefinition {
  return {
    name: 'update_working_memory',
    description:
      "Update this user's working memory profile - a small set of key facts that should persist " +
      'across turns (preferences, project context, current goals). Calling this REPLACES the entire ' +
      'profile: first include the existing content (shown under "## User Profile" in the system ' +
      'prompt), then apply your changes. Do not store chat transcripts or transient details. ' +
      `Keep it under ${WORKING_MEMORY_MAX_CHARS} characters.`,
    risk: 'read',
    timeoutMs: 5_000,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The full new profile text (compact JSON or plain text), including retained existing facts',
        },
      },
      required: ['content'],
    },
    argsSchema: z.object({ content: z.string() }),
    async execute(args) {
      const { content } = args as { content: string }
      if (content.length > WORKING_MEMORY_MAX_CHARS) {
        throw new ToolError(
          `working memory must stay under ${WORKING_MEMORY_MAX_CHARS} characters ` +
            `(got ${content.length}). Rewrite it more compactly.`,
        )
      }
      memory.store.updateSession(memory.session.id, { workingMemory: content })
      memory.session.workingMemory = content
      return { output: `working memory updated (${content.length} chars)` }
    },
  }
}
