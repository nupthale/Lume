import type { TodoRow } from '../memory/store.js'

export const SYSTEM_PROMPT = `You are lume, a precise software engineering assistant operating in a working directory.

Working style:
- For anything involving files or commands, use the provided tools instead of guessing.
- Prefer the smallest action that answers the question (read before edit, targeted edit before rewrite).
- Never fabricate file contents or command output; if you need to know, run the tool.

Task tracking (mandatory):
- Before starting any request that will take 3 or more steps, you MUST first call todo_write to lay out the steps, then work through them, calling todo_write again to mark each item in_progress/completed as you go.
- Never fabricate a tool result: if a previous tool call has no result (aborted/interrupted), re-run it instead of assuming what it returned.

When you finish the user's request, reply with a concise summary in the user's language.`

/**
 * Fresh environment facts (time / OS / working directory) recomputed at every
 * turn assembly, so the model never needs a tool call just to learn the date.
 */
export function envPromptSection(cwd: string): string {
  const now = new Date()
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const local = now.toLocaleString('sv-SE', { hour12: false })
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const lines = [
    `- Current time: ${local} (${tz}), ${weekday}`,
    `- OS: ${process.platform} ${process.arch}`,
  ]
  if (cwd !== '') lines.push(`- Working directory: ${cwd}`)
  return `\n## Environment\n${lines.join('\n')}\n`
}

/**
 * The skill inventory appended to the system prompt. Only name+description
 * (progressive disclosure): the model fetches full instructions on demand via
 * the load_skill tool.
 */
export function skillsPromptSection(skills: Array<{ name: string; description: string }>): string {
  if (skills.length === 0) return ''
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  return (
    `\nSkills available in this workspace ` +
    `(call load_skill(name) to load the full instructions BEFORE following a skill):\n${lines}\n`
  )
}

/**
 * Layered-memory sections appended to the system prompt (after the skill
 * inventory): Layer 1 working memory, the Layer 2 rolling summary and the
 * Layer 3 semantic recall block (filled in once embeddings are enabled).
 * Empty inputs render no section, so a fresh session carries no memory chrome.
 */
export function memoryPromptSections(input: {
  workingMemory: string
  summary: string
  semanticRecall: string
}): string {
  const sections: string[] = []
  if (input.workingMemory !== '') {
    sections.push(`\n## User Profile (maintained by update_working_memory)\n${input.workingMemory}\n`)
  }
  if (input.summary !== '') {
    sections.push(`\n## Conversation So Far (rolling summary)\n${input.summary}\n`)
  }
  if (input.semanticRecall !== '') {
    sections.push(`\n## Relevant Long-term Memories\n${input.semanticRecall}\n`)
  }
  return sections.join('')
}

/**
 * The cross-session task list, injected each turn BEFORE the memory sections
 * so the model always sees its current todos. Empty input renders no section
 * (a fresh session or a cleared list carries no todo chrome).
 */
export function todosPromptSection(todos: TodoRow[]): string {
  if (todos.length === 0) return ''
  const lines = todos.map((t) => `- [${t.status}] ${t.content}`).join('\n')
  return (
    '\n## Task List (maintained by todo_write; ' +
    `overwrite semantics — always send the full updated list)\n${lines}\n`
  )
}
