import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { pathBoundaryCheck } from './read.js'
import { type ToolDefinition, ToolError, resolveInsideCwd } from './types.js'

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description:
    'Replace an exact string in a file. The old string must match exactly once ' +
    '(unless replace_all is true) or the edit is rejected, which guards against ' +
    'ambiguous replacements.',
  risk: 'write',
  timeoutMs: 10_000,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative or absolute)' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (optional)' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  argsSchema: z.object({
    path: z.string().min(1),
    old_string: z.string().min(1),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  reviewChecks: (args, cwd) => [pathBoundaryCheck(args, cwd)],
  async execute(args, ctx) {
    const { path, old_string, new_string, replace_all } = args as {
      path: string
      old_string: string
      new_string: string
      replace_all?: boolean
    }
    const resolved = resolveInsideCwd(ctx.cwd, path)
    if (resolved === null) {
      throw new ToolError(`path escapes the working directory: ${path}`)
    }

    let content: string
    try {
      content = await readFile(resolved, 'utf8')
    } catch (err) {
      throw new ToolError(`cannot read file: ${(err as Error).message}`)
    }

    const count = occurrences(content, old_string)
    if (count === 0) {
      throw new ToolError('old_string not found in file')
    }
    if (count > 1 && replace_all !== true) {
      throw new ToolError(
        `old_string found ${count} times; pass replace_all=true or provide a longer, unique string`,
      )
    }

    const updated =
      replace_all === true
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string)
    try {
      await writeFile(resolved, updated, 'utf8')
    } catch (err) {
      throw new ToolError(`cannot write file: ${(err as Error).message}`)
    }
    return { output: `replaced ${replace_all === true ? count : 1} occurrence(s) in ${path}` }
  },
}

function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx >= 0) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}
