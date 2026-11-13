import type { ReviewCheck, ToolRisk } from '@lume/protocol'
import type { z } from 'zod'

export interface ToolContext {
  cwd: string
  signal: AbortSignal
  /** hard output cap in characters */
  maxOutputChars: number
  /** readable roots outside cwd (discovered skill directories) */
  skillDirs?: string[]
}

export interface ToolResult {
  output: string
  truncated?: boolean
}

export class ToolError extends Error {
  readonly timeout: boolean
  constructor(message: string, opts: { timeout?: boolean } = {}) {
    super(message)
    this.name = 'ToolError'
    this.timeout = opts.timeout ?? false
  }
}

/**
 * A tool definition. `parameters` is the JSON Schema handed to the LLM;
 * `argsSchema` is the zod schema used to validate parsed arguments before
 * execution (both are hand-written per tool; no schema conversion magic).
 */
export interface ToolDefinition {
  name: string
  description: string
  risk: ToolRisk
  /** JSON Schema describing the `parameters` object */
  parameters: Record<string, unknown>
  /** zod validation for parsed args */
  argsSchema: z.ZodTypeAny
  /** default execution timeout (ms); per-call override wins */
  timeoutMs: number
  /**
   * Static safety checks executed during the harness review phase,
   * BEFORE permission/execution. A failed check blocks the call.
   */
  reviewChecks?(
    args: Record<string, unknown>,
    cwd: string,
    skillDirs?: string[],
  ): ReviewCheck[]
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

export function truncateOutput(output: string, maxChars: number): ToolResult {
  if (output.length <= maxChars) return { output }
  return {
    output: `${output.slice(0, maxChars)}\n... [truncated ${output.length - maxChars} chars]`,
    truncated: true,
  }
}

/** Resolve a tool-supplied path against cwd. Returns null when outside cwd. */
export function resolveInsideCwd(cwd: string, path: string): string | null {
  return resolveWithin([cwd], path)
}

/**
 * Resolve a path against cwd first, then any extra readable roots
 * (skill directories). Returns null when outside all of them.
 */
export function resolveWithin(roots: string[], path: string): string | null {
  for (const root of roots) {
    const resolved = path.startsWith('/') ? path : `${root}/${path}`
    const normalized = normalizePath(resolved)
    const normalizedRoot = normalizePath(root)
    if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) {
      return normalized
    }
  }
  return null
}

function normalizePath(p: string): string {
  const parts = p.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return `/${out.join('/')}`
}
