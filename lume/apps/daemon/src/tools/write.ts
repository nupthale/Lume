import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { pathBoundaryCheck } from './read.js'
import { type ToolDefinition, ToolError, resolveInsideCwd } from './types.js'

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description:
    'Create or overwrite a file with the given content. Parent directories are created ' +
    'automatically. Paths are resolved against the working directory.',
  risk: 'write',
  timeoutMs: 10_000,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative or absolute)' },
      content: { type: 'string', description: 'Full file content to write' },
    },
    required: ['path', 'content'],
  },
  argsSchema: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  reviewChecks: (args, cwd) => [pathBoundaryCheck(args, cwd)],
  async execute(args, ctx) {
    const { path, content } = args as { path: string; content: string }
    const resolved = resolveInsideCwd(ctx.cwd, path)
    if (resolved === null) {
      throw new ToolError(`path escapes the working directory: ${path}`)
    }
    try {
      await mkdir(dirname(resolved), { recursive: true })
      await writeFile(resolved, content, 'utf8')
    } catch (err) {
      throw new ToolError(`cannot write file: ${(err as Error).message}`)
    }
    return { output: `wrote ${content.length} chars to ${path}` }
  },
}
