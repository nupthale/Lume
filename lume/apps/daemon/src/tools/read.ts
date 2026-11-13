import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { type ToolDefinition, ToolError, resolveWithin, truncateOutput } from './types.js'

export function pathBoundaryCheck(
  args: Record<string, unknown>,
  cwd: string,
  skillDirs?: string[],
): { name: 'path_inside_cwd'; passed: boolean; detail: string } {
  const path = String(args.path ?? '')
  const inside = resolveWithin([cwd, ...(skillDirs ?? [])], path) !== null
  return {
    name: 'path_inside_cwd',
    passed: inside,
    detail: inside
      ? 'resolved inside cwd or a skill directory'
      : `path escapes the working directory: ${path}`,
  }
}

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read a text file. Paths are resolved against the working directory; ' +
    'files inside installed skill directories are also readable (absolute paths). ' +
    'Use offset/limit for large files (1-based line numbers).',
  risk: 'read',
  timeoutMs: 10_000,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative or absolute)' },
      offset: { type: 'integer', description: 'First line to read (1-based, optional)' },
      limit: { type: 'integer', description: 'Max number of lines to read (optional)' },
    },
    required: ['path'],
  },
  argsSchema: z.object({
    path: z.string().min(1),
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(10_000).optional(),
  }),
  reviewChecks: (args, cwd, skillDirs) => [pathBoundaryCheck(args, cwd, skillDirs)],
  async execute(args, ctx) {
    const { path, offset, limit } = args as {
      path: string
      offset?: number
      limit?: number
    }
    const resolved = resolveWithin([ctx.cwd, ...(ctx.skillDirs ?? [])], path)
    if (resolved === null) {
      throw new ToolError(`path escapes the working directory: ${path}`)
    }
    let content: string
    try {
      content = await readFile(resolved, 'utf8')
    } catch (err) {
      throw new ToolError(`cannot read file: ${(err as Error).message}`)
    }
    let lines = content.split('\n')
    const start = offset !== undefined ? offset - 1 : 0
    if (start > 0) lines = lines.slice(start)
    if (limit !== undefined) lines = lines.slice(0, limit)
    const body = lines.map((l, i) => `${start + i + 1}→${l}`).join('\n')
    return truncateOutput(body, ctx.maxOutputChars)
  },
}
