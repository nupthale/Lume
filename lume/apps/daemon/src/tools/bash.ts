import { z } from 'zod'
import { type ToolContext, type ToolDefinition, ToolError, truncateOutput } from './types.js'

/** Bash commands that are unconditionally rejected during review. */
const DANGEROUS_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /rm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f?\s+\/(\s|$)/, label: 'recursive delete rooted at /' },
  { re: /rm\s+-[a-z]*r[a-z]*f?\s+~/, label: 'recursive delete of home directory' },
  { re: /sudo\b/, label: 'sudo is not allowed' },
  { re: /dd\s+.*of=\/dev\//, label: 'raw device write' },
  { re: /:\(\)\s*\{\s*:\|:&\s*\};:/, label: 'fork bomb' },
  { re: /(curl|wget)\s+[^|]*\|\s*(ba)?sh\b/, label: 'pipe remote content into shell' },
  { re: /chmod\s+-R\s+777\s+\//, label: 'recursive world-writable chmod on /' },
  { re: /mkfs(\.\w+)?\b/, label: 'filesystem format' },
  { re: />\s*\/dev\/sd[a-z]/, label: 'direct write to disk device' },
]

export const bashTool: ToolDefinition = {
  name: 'bash',
  description:
    'Run a shell command with /bin/bash -c in the current working directory. ' +
    'Returns combined stdout and stderr. Use for builds, git, and inspection commands.',
  risk: 'execute',
  timeoutMs: 60_000,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout_ms: {
        type: 'integer',
        description: 'Optional timeout in milliseconds (max 300000)',
      },
    },
    required: ['command'],
  },
  argsSchema: z.object({
    command: z.string().min(1),
    timeout_ms: z.number().int().positive().max(300_000).optional(),
  }),
  reviewChecks(args) {
    const command = String(args.command ?? '')
    for (const { re, label } of DANGEROUS_PATTERNS) {
      if (re.test(command)) {
        return [{ name: 'bash_safety', passed: false, detail: `blocked: ${label}` }]
      }
    }
    return [{ name: 'bash_safety', passed: true, detail: 'no dangerous pattern detected' }]
  },
  async execute(args, ctx) {
    const { command, timeout_ms } = args as { command: string; timeout_ms?: number }
    const timeoutMs = timeout_ms ?? 60_000
    return truncateOutput(await runBash(command, ctx, timeoutMs), ctx.maxOutputChars)
  },
}

async function runBash(command: string, ctx: ToolContext, timeoutMs: number): Promise<string> {
  const { spawn } = await import('node:child_process')
  return new Promise<string>((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', command], { cwd: ctx.cwd })
    let output = ''
    let settled = false

    const append = (buf: Buffer) => {
      // cap in-memory buffering well above the reporting cap
      if (output.length < ctx.maxOutputChars * 2) output += buf.toString('utf8')
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new ToolError(`command timed out after ${timeoutMs}ms`, { timeout: true }))
    }, timeoutMs)

    const onAbort = () => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new ToolError('command aborted', { timeout: false }))
    }
    if (ctx.signal.aborted) {
      onAbort()
      return
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ToolError(`failed to spawn command: ${err.message}`))
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const suffix =
        code !== null ? `\n[exit code: ${code}]` : `\n[killed by signal: ${signal ?? 'unknown'}]`
      resolve(`${output}${suffix}`)
    })
  })
}
