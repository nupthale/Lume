import { readFile, stat } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import { z } from 'zod'
import { globToRegExp, walkFiles } from './glob.js'
import { pathBoundaryCheck } from './read.js'
import { type ToolContext, type ToolDefinition, ToolError, resolveWithin, truncateOutput } from './types.js'

interface GrepArgs {
  pattern: string
  path?: string
  glob?: string
  ignore_case?: boolean
  context?: number
  head_limit?: number
}

/** rg availability probe, executed once per process and cached. */
let rgProbe: Promise<boolean> | undefined

function isRgAvailable(): Promise<boolean> {
  rgProbe ??= new Promise<boolean>((resolve) => {
    void import('node:child_process').then(({ spawn }) => {
      const child = spawn('rg', ['--version'])
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    })
  })
  return rgProbe
}

function compilePattern(pattern: string, ignoreCase?: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? 'i' : '')
  } catch (err) {
    throw new ToolError(`invalid regex '${pattern}': ${(err as Error).message}`)
  }
}

function resolveSearchRoot(args: GrepArgs, ctx: ToolContext): string {
  const roots = [ctx.cwd, ...(ctx.skillDirs ?? [])]
  const root = resolveWithin(roots, args.path ?? '.')
  if (root === null) {
    throw new ToolError(`path escapes the working directory: ${args.path ?? '.'}`)
  }
  return root
}

export const grepTool: ToolDefinition = {
  name: 'grep',
  description:
    'Search file contents with a regular expression, grep-style (path:line:content). ' +
    'Searches the working directory by default; node_modules/.git/dist are skipped. ' +
    'Uses ripgrep when available, otherwise a pure Node walker.',
  risk: 'read',
  timeoutMs: 10_000,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for (RE2/JS syntax)' },
      path: { type: 'string', description: 'File or directory to search (default ".")' },
      glob: { type: 'string', description: "Only search files matching this glob, e.g. '*.ts'" },
      ignore_case: { type: 'boolean', description: 'Case-insensitive matching (default false)' },
      context: {
        type: 'integer',
        description: 'Lines of context around matches (0-5, default 0)',
      },
      head_limit: { type: 'integer', description: 'Max number of output lines (default 100)' },
    },
    required: ['pattern'],
  },
  argsSchema: z.object({
    pattern: z.string().min(1),
    path: z.string().optional(),
    glob: z.string().optional(),
    ignore_case: z.boolean().optional(),
    context: z.number().int().min(0).max(5).optional(),
    head_limit: z.number().int().positive().optional(),
  }),
  reviewChecks: (args, cwd, skillDirs) => [pathBoundaryCheck(args, cwd, skillDirs)],
  async execute(args, ctx: ToolContext) {
    const parsed = args as {
      pattern: string
      path?: string
      glob?: string
      ignore_case?: boolean
      context?: number
      head_limit?: number
    }
    compilePattern(parsed.pattern, parsed.ignore_case) // fail fast on bad regex
    if (await isRgAvailable()) {
      const res = await runRg(parsed, ctx)
      if (res !== undefined) {
        const cleaned = res
          .split('\n')
          .map((line) => (line.startsWith('./') ? line.slice(2) : line))
          .join('\n')
        return truncateOutput(capLines(cleaned, parsed.head_limit ?? 100), ctx.maxOutputChars)
      }
    }
    return truncateOutput(await grepWithNode(parsed, ctx), ctx.maxOutputChars)
  },
}

/**
 * Run ripgrep. Returns the raw stdout on exit codes 0/1, or undefined when rg
 * errored (exit 2 / spawn failure) so the caller can fall back to Node.
 */
async function runRg(args: GrepArgs, ctx: ToolContext): Promise<string | undefined> {
  const { spawn } = await import('node:child_process')
  const root = resolveSearchRoot(args, ctx)
  const argv = [
    '--line-number',
    '--no-heading',
    '--with-filename', // single-file searches must still print the path prefix
    '--color',
    'never',
    '--no-messages',
    // mirror the Node walker's always-skip list (rg only skips these when a
    // .gitignore lists them, which is not guaranteed outside git checkouts)
    '--glob',
    '!node_modules',
    '--glob',
    '!.git',
    '--glob',
    '!dist',
  ]
  if (args.ignore_case) argv.push('--ignore-case')
  if (args.glob !== undefined) argv.push('--glob', args.glob)
  if (args.context !== undefined && args.context > 0) argv.push('--context', String(args.context))
  argv.push('--', args.pattern)
  const cwdNorm = resolveWithin([ctx.cwd], '.') ?? ctx.cwd
  // always pass an explicit root: with no path argument rg would read STDIN
  // when it is not a terminal (which hangs under programmatic spawn)
  argv.push(root === cwdNorm ? '.' : relative(ctx.cwd, root) || root)

  return new Promise<string | undefined>((resolve) => {
    const child = spawn('rg', argv, { cwd: ctx.cwd })
    let stdout = ''
    const append = (buf: Buffer) => {
      if (stdout.length < ctx.maxOutputChars * 2) stdout += buf.toString('utf8')
    }
    child.stdout.on('data', append)
    child.stderr.on('data', () => {}) // --no-messages keeps stderr quiet; ignore leftovers
    const fallback = () => resolve(undefined)
    child.on('error', fallback)
    child.on('close', (code) => {
      if (code === 0 || code === 1) resolve(code === 0 ? stdout : 'no matches')
      else fallback()
    })
  })
}

function capLines(output: string, limit: number): string {
  const lines = output.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.slice(0, limit).join('\n')
}

/**
 * Pure-Node grep used when ripgrep is unavailable (or rejects a pattern its
 * RE2 engine does not support). Exported for direct testing.
 */
export async function grepWithNode(args: GrepArgs, ctx: ToolContext): Promise<string> {
  const regex = compilePattern(args.pattern, args.ignore_case)
  const root = resolveSearchRoot(args, ctx)
  const limit = args.head_limit ?? 100

  let files: string[]
  try {
    const rootStat = await stat(root)
    files = rootStat.isFile() ? [root] : await walkFiles(root)
  } catch (err) {
    throw new ToolError(`cannot search ${args.path ?? '.'}: ${(err as Error).message}`)
  }

  let globMatcher: RegExp | undefined
  let byBasename = false
  if (args.glob !== undefined) {
    globMatcher = globToRegExp(args.glob)
    byBasename = !args.glob.includes('/')
  }

  const out: string[] = []
  for (const file of files) {
    if (out.length >= limit) break
    if (
      globMatcher !== undefined &&
      !(byBasename ? globMatcher.test(basename(file)) : globMatcher.test(relative(root, file)))
    ) {
      continue
    }
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue // unreadable/binary: skip like rg does
    }
    if (content.includes('\u0000')) continue
    emitFileMatches(relative(ctx.cwd, file), content.split('\n'), regex, args.context ?? 0, out, limit)
  }
  return out.length === 0 ? 'no matches' : out.join('\n')
}

/** Append `rel:line:content` (and `-`-separated context lines) for one file. */
function emitFileMatches(
  rel: string,
  lines: string[],
  regex: RegExp,
  context: number,
  out: string[],
  limit: number,
): void {
  const hits: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i] ?? '')) hits.push(i)
  }
  if (hits.length === 0) return

  if (context === 0) {
    for (const i of hits) {
      if (out.length >= limit) return
      out.push(`${rel}:${i + 1}:${lines[i] ?? ''}`)
    }
    return
  }

  // merge [i-context, i+context] windows, grep-style with `--` between groups
  const first = hits[0] ?? 0
  let lo = Math.max(0, first - context)
  let hi = Math.min(lines.length - 1, first + context)
  for (const i of hits.slice(1)) {
    if (i - context <= hi + 1) {
      hi = Math.min(lines.length - 1, i + context)
      continue
    }
    emitRange(rel, lines, hits, lo, hi, out, limit)
    if (out.length >= limit) return
    out.push('--')
    lo = Math.max(0, i - context)
    hi = Math.min(lines.length - 1, i + context)
  }
  emitRange(rel, lines, hits, lo, hi, out, limit)
}

function emitRange(
  rel: string,
  lines: string[],
  hits: number[],
  lo: number,
  hi: number,
  out: string[],
  limit: number,
): void {
  const hitSet = new Set(hits)
  for (let i = lo; i <= hi; i++) {
    if (out.length >= limit) return
    const sep = hitSet.has(i) ? ':' : '-'
    out.push(`${rel}${sep}${i + 1}${sep}${lines[i]}`)
  }
}
