import { z } from 'zod'
import { todosPromptSection } from '../core/prompts.js'
import { type ToolDefinition } from '../tools/types.js'
import type { MemoryStore, SessionRow, TodoStatus } from './store.js'

/** hard cap on the list: it is re-injected into the system prompt every turn */
export const TODO_MAX_ITEMS = 50
/** per-item content cap; rejects rather than silently truncating */
export const TODO_CONTENT_MAX_CHARS = 500

/**
 * todo_write: cross-session task list.
 *
 * The list persists in the todos table (shared across sessions) and is
 * injected under "## Task List" in every turn's system prompt. Each call
 * REPLACES the whole list: the model must send the complete updated list,
 * not a delta. Marking an item in_progress before starting work on it and
 * completed once done keeps the visible state truthful; an empty array
 * clears the list.
 *
 * risk: read -> auto-approved by the permission policy (the list only
 * shapes future prompts; it never touches the user's filesystem).
 */
export function makeTodoWriteTool(
  memory: { store: MemoryStore; session: SessionRow },
): ToolDefinition {
  return {
    name: 'todo_write',
    description:
      'Task list tool. Proactively create a list when the user\'s request needs 3 or more steps, ' +
      'and keep it updated as you work: this is how you track your own progress across tool calls. ' +
      'The current task list is shown under "## Task List" in the system prompt each turn. ' +
      'Every call must send the COMPLETE new list (overwrite semantics, not a delta): carry over unfinished items, ' +
      'mark an item in_progress right before you start working on it, and mark it completed once done. ' +
      `Pass an empty array to clear the whole list. At most ${TODO_MAX_ITEMS} items.`,
    risk: 'read',
    timeoutMs: 5_000,
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          maxItems: TODO_MAX_ITEMS,
          description: 'The complete new task list (replaces the stored list)',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                minLength: 1,
                maxLength: TODO_CONTENT_MAX_CHARS,
                description: 'Task description (1-500 characters)',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'pending = not started, in_progress = actively working on it, completed = done',
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    argsSchema: z.object({
      todos: z
        .array(
          z.object({
            content: z.string().min(1).max(TODO_CONTENT_MAX_CHARS),
            status: z.enum(['pending', 'in_progress', 'completed']),
          }),
        )
        .max(TODO_MAX_ITEMS),
    }),
    async execute(args) {
      const { todos } = args as { todos: Array<{ content: string; status: TodoStatus }> }
      const rows = memory.store.replaceTodos(todos, memory.session.id)
      // mirror the system-prompt section so the REPL's tool_completed render
      // shows the list exactly as the next turn will see it
      return { output: rows.length === 0 ? 'task list cleared (0 todos)' : todosPromptSection(rows) }
    },
  }
}
