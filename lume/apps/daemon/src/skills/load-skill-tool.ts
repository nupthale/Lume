import { z } from 'zod'
import { type ToolDefinition, truncateOutput } from '../tools/types.js'
import type { SkillIndex } from './skills.js'

/**
 * load_skill: fetches the full SKILL.md body for a skill listed in the system
 * prompt. Read-only (risk: read -> auto-approved); the body itself is
 * untrusted instruction content, same trust level as any user file the model
 * reads.
 */
export function makeLoadSkillTool(index: SkillIndex): ToolDefinition {
  return {
    name: 'load_skill',
    description:
      'Load the full instructions of a skill by name. Call this BEFORE following any ' +
      'skill listed in the system prompt; the listed description is only a summary.',
    risk: 'read',
    timeoutMs: 5_000,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name exactly as listed in the system prompt' },
      },
      required: ['name'],
    },
    argsSchema: z.object({ name: z.string().min(1) }),
    async execute(args, ctx) {
      const { name } = args as { name: string }
      const body = await index.load(name)
      return truncateOutput(body, ctx.maxOutputChars)
    },
  }
}
