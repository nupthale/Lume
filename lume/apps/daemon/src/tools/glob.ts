import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { pathBoundaryCheck } from './read.js'
import { type ToolContext, type ToolDefinition, ToolError, resolveWithin, truncateOutput } from './types.js'

/** Directories never entered by the glob/grep Node walkers. */
export const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist'])

/**
 * Translate a glob pattern (`**`, `*`, `?`, `{a,b}`) into an anchored RegExp.
 * `*` and `?` never cross `/`; a `**` segment (with or without a trailing
 * slash) crosses directories.
 */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${globFragmentSource(pattern)}$`)
}

/** Unanchored regex source for a glob fragment; alternations recurse here. */
function globFragmentSource(pattern: string): string {
  let re = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i] ?? ''
    if (c === '*') {
      let j = i
      while (pattern[j] === '*') j++
      if (j - i >= 2) {
        re += pattern[j] === '/' ? '(?:.*/)?' : '.*'
        i = pattern[j] === '/' ? j + 1 : j
      } else {
        re += '[^/]*'
        i++
      }
    } else if (c === '?') {
      re += '[^/]'
      i++
    } else if (c === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) {
        re += '\\{'
        i++
      } else {
        const alts = pattern
          .slice(i + 1, end)
          .split(',')
          .map((p) => globFragmentSource(p))
        re += `(?:${alts.join('|')})`
        i = end + 1
      }
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return re
}

/** Walk `root` collecting file paths (skips node_modules/.git/dist and symlinks). */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      out.push(...(await walkFiles(full)))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

export const globTool: ToolDefinition = {
  name: 'glob',
  description:
    'Find files by glob pattern (**, *, ?, {a,b}) under a directory. Returns file paths ' +
    'relative to the working directory, newest first. Searches cwd by default; ' +
    'node_modules/.git/dist are always skipped.',
  risk: 'read',
  timeoutMs: 10_000,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: "Glob pattern, e.g. 'src/**/*.ts' or '*.{ts,tsx}'",
      },
      path: { type: 'string', description: 'Root directory (relative or absolute, default ".")' },
      head_limit: { type: 'integer', description: 'Max number of paths to return (default 200)' },
    },
    required: ['pattern'],
  },
  argsSchema: z.object({
    pattern: z.string().min(1),
    path: z.string().optional(),
    head_limit: z.number().int().positive().optional(),
  }),
  reviewChecks: (args, cwd, skillDirs) => [pathBoundaryCheck(args, cwd, skillDirs)],
  async execute(args, ctx: ToolContext) {
    const { pattern, path: searchPath, head_limit: headLimit } = args as {
      pattern: string
      path?: string
      head_limit?: number
    }
    const roots = [ctx.cwd, ...(ctx.skillDirs ?? [])]
    const root = resolveWithin(roots, searchPath ?? '.')
    if (root === null) {
      throw new ToolError(`path escapes the working directory: ${searchPath ?? '.'}`)
    }

    let files: string[]
    try {
      files = await walkFiles(root)
    } catch (err) {
      throw new ToolError(`cannot search ${searchPath ?? '.'}: ${(err as Error).message}`)
    }

    const matcher = globToRegExp(pattern)
    const matched: Array<{ file: string; mtimeMs: number }> = []
    for (const file of files) {
      const relToRoot = relative(root, file)
      if (!matcher.test(relToRoot)) continue
      let mtimeMs: number
      try {
        mtimeMs = (await stat(file)).mtimeMs
      } catch {
        continue // raced deletion: just skip
      }
      matched.push({ file, mtimeMs })
    }
    matched.sort((a, b) => b.mtimeMs - a.mtimeMs)

    const limit = headLimit ?? 200
    const paths = matched.slice(0, limit).map((m) => relative(ctx.cwd, m.file))
    const output = paths.length === 0 ? 'no matches' : paths.join('\n')
    return truncateOutput(output, ctx.maxOutputChars)
  },
}
