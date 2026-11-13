import { z } from 'zod'
import { type ToolDefinition, ToolError } from '../tools/types.js'
import type { EmbeddingClient } from './embedding.js'
import { saveFact } from './semantic.js'
import type { MemoryStore, SessionRow } from './store.js'

/**
 * save_memory: Layer 3 semantic memory.
 *
 * Persists a durable fact that should outlive the current session (user
 * preferences, constraints, key background knowledge). This is not a
 * conversation log: transcripts already live in the episodic store. Near
 * duplicates are detected by embedding cosine and skipped, which the model
 * sees as a normal (non-error) result.
 *
 * risk: read -> auto-approved by the permission policy (the fact only shapes
 * future prompts via semantic recall; it never touches the user's filesystem).
 */
export function makeSaveMemoryTool(
  deps: { embedder: EmbeddingClient; store: MemoryStore; session: SessionRow },
): ToolDefinition {
  return {
    name: 'save_memory',
    description:
      'Save a long-term fact that should persist across sessions (user preferences, constraints, ' +
      'key background knowledge). This is NOT for conversation history or transient details - only ' +
      'stable facts worth recalling in future sessions. A similar existing memory is skipped ' +
      'automatically, so there is no need to check before saving.',
    risk: 'read',
    timeoutMs: 30_000,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The fact to remember, stated concisely (e.g. "The user is allergic to peanuts.")',
        },
      },
      required: ['content'],
    },
    argsSchema: z.object({ content: z.string() }),
    async execute(args) {
      const { content } = args as { content: string }
      try {
        const result = await saveFact(
          { embedder: deps.embedder, store: deps.store },
          { content, sessionId: deps.session.id },
        )
        if (result.reason === 'duplicate') {
          return { output: 'skipped: similar memory already exists' }
        }
        return { output: `saved: ${content}` }
      } catch (err) {
        // embedding backend down / malformed response: surface the failure so
        // the model knows nothing was stored
        throw new ToolError(
          `failed to save memory: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },
  }
}
