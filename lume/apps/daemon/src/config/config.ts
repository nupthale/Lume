import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Expand a leading `~` / `~/` to the user's home directory; other paths are
 * returned unchanged. Applied to both env values and defaults (e.g. the
 * `~/.lume/lume.db` default) so paths are always absolute where possible.
 */
export function expandHomePath(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/**
 * Daemon configuration, sourced from environment variables.
 * All values are validated at startup; config errors are fatal.
 */
export const ConfigSchema = z.object({
  /** 'openai' (default) or 'fake' (scripted provider for tests/smoke runs) */
  provider: z.enum(['openai', 'fake']).default('openai'),
  apiBaseUrl: z.string().url(),
  apiKey: z.string().default('EMPTY'),
  model: z.string().min(1),
  /** working directory tools operate in */
  cwd: z.string().min(1),
  /** max tool-call micro cycles per turn before forcing a final answer */
  maxToolLoopsPerTurn: z.number().int().positive().max(200).default(25),
  /** LLM request timeout (ms) */
  requestTimeoutMs: z.number().int().positive().default(120_000),
  /** default tool execution timeout (ms) */
  toolTimeoutMs: z.number().int().positive().default(60_000),
  /** max characters of tool output fed back / emitted */
  maxToolOutputChars: z.number().int().positive().default(30_000),
  /** tool names that skip human permission regardless of risk level */
  autoApproveTools: z.array(z.string()).default([]),
  /** SQLite database file backing the layered session memory (Layer 1-3) */
  dbPath: z.string().min(1).default(expandHomePath('~/.lume/lume.db')),
  /** embedding model for Layer 3 semantic memory; unset disables Layer 3 entirely */
  embedModel: z.string().optional(),
  /** number of verbatim messages in the recent-message context window */
  contextK: z.coerce.number().int().positive().default(30),
  /** unsummarized message count that triggers incremental summarization */
  summarizeThreshold: z.coerce.number().int().positive().default(20),
})

export type Config = z.infer<typeof ConfigSchema>

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Load and validate config from an environment object (defaults: process.env). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse({
    provider: env.LUME_PROVIDER,
    apiBaseUrl: env.LUME_API_BASE_URL,
    apiKey: env.LUME_API_KEY,
    model: env.LUME_MODEL,
    cwd: env.LUME_CWD ?? process.cwd(),
    maxToolLoopsPerTurn: env.LUME_MAX_TOOL_LOOPS,
    requestTimeoutMs: env.LUME_REQUEST_TIMEOUT_MS,
    toolTimeoutMs: env.LUME_TOOL_TIMEOUT_MS,
    maxToolOutputChars: env.LUME_MAX_TOOL_OUTPUT_CHARS,
    autoApproveTools: env.LUME_AUTO_APPROVE_TOOLS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dbPath: expandHomePath(env.LUME_DB_PATH ?? '~/.lume/lume.db'),
    embedModel: env.LUME_EMBED_MODEL || undefined,
    contextK: env.LUME_CONTEXT_K,
    summarizeThreshold: env.LUME_SUMMARIZE_THRESHOLD,
  })

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new ConfigError(
      `Invalid configuration. Missing/invalid environment variables:\n${issues}\nRequired: LUME_API_BASE_URL, LUME_MODEL (unless LUME_PROVIDER=fake).`,
    )
  }
  return result.data
}
