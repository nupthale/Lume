import type { ReviewCheck } from '@lume/protocol'
import type { Config } from '../config/config.js'
import type { PersistableChatMessage } from '../memory/mapping.js'
import type { ChatMessage, LlmProvider, ToolCallPayload } from '../providers/types.js'
import { aggregateStream } from '../providers/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import { type ToolContext, ToolError } from '../tools/types.js'
import { shortId } from '../util/id.js'
import type { Logger } from '../util/logger.js'
import { TurnAbortedError } from './errors.js'
import type { TurnEvents } from './events.js'
import type { Frontend } from './frontend.js'
import type { PermissionPolicy } from './permission.js'
import type { SkillIndex } from '../skills/skills.js'

export interface MicroCycleContext {
  turnId: string
  signal: AbortSignal
  events: TurnEvents
  /** shared conversation history; the harness appends the tool result message */
  history: ChatMessage[]
  /** invoked with each tool result message after it enters the history; used to mirror it into the store */
  onMessage?: (msg: PersistableChatMessage) => void
}

export type MicroCycleOutcome = 'completed' | 'denied' | 'safety_blocked' | 'failed'

export interface MicroCycleResult {
  outcome: MicroCycleOutcome
  verification?: { passed: boolean; note?: string }
}

const VERIFY_MAX_TOKENS = 300

/**
 * Harness: the think -> review -> act -> verify micro cycle.
 *
 * The think phase (streaming the assistant reply that requested the tool)
 * lives in the Agent; this class executes one full cycle per tool call:
 *
 *   review  static safety checks + permission policy + human approval
 *   act     registry execution with timeout and abort support
 *   verify  a tool-free LLM judgement of whether the result met the intent
 *
 * The cycle emits every phase on the event stream and appends the tool
 * result message to the shared history.
 */
export class Harness {
  constructor(
    private readonly deps: {
      provider: LlmProvider
      tools: ToolRegistry
      policy: PermissionPolicy
      config: Config
      logger: Logger
      /** skill discovery; skill dirs become extra readable roots for tools */
      skills?: SkillIndex
    },
  ) {}

  /** Bind/replace the frontend (skins do this after agent construction). */
  rebindFrontend(frontend: Frontend): void {
    this.frontend = frontend
  }

  private frontend: Frontend | null = null

  async runToolCall(ctx: MicroCycleContext, call: ToolCallPayload): Promise<MicroCycleResult> {
    const { events, signal } = ctx
    const callId = shortId('call')

    // ---- think (artifact): announce the requested call --------------------
    let args: Record<string, unknown>
    try {
      const parsed = JSON.parse(call.arguments) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object')
      }
      args = parsed as Record<string, unknown>
    } catch {
      events.toolCallRequested(callId, call.name, {})
      events.toolFailed(callId, 'tool_error', 'tool arguments are not a valid JSON object')
      this.appendToolMessage(ctx, call, '(error: arguments were not valid JSON)')
      return { outcome: 'failed' }
    }
    events.toolCallRequested(callId, call.name, args)

    const tool = this.deps.tools.get(call.name)
    if (tool === undefined) {
      events.toolFailed(callId, 'tool_error', `unknown tool: ${call.name}`)
      this.appendToolMessage(ctx, call, `(error: unknown tool ${call.name})`)
      return { outcome: 'failed' }
    }

    // ---- review ------------------------------------------------------------
    events.reviewStarted(callId)
    const checks: ReviewCheck[] = []

    const schemaCheck = this.checkSchema(call, args)
    checks.push(schemaCheck)
    checks.push(
      ...(tool.reviewChecks?.(args, this.deps.config.cwd, this.deps.skills?.roots()) ?? []),
    )

    const allPassed = checks.every((c) => c.passed)
    const requiresPermission = allPassed && this.deps.policy.requiresApproval(tool.name, tool.risk)
    events.reviewCompleted(callId, checks, allPassed, requiresPermission)

    if (!allPassed) {
      const failed = checks
        .filter((c) => !c.passed)
        .map((c) => c.detail)
        .join('; ')
      const message = `(blocked by safety review: ${failed})`
      events.toolFailed(callId, 'safety_blocked', message)
      this.appendToolMessage(ctx, call, message)
      return { outcome: 'safety_blocked' }
    }

    if (requiresPermission) {
      if (this.frontend === null) {
        throw new Error('Harness frontend not bound; call rebindFrontend() first')
      }
      const approved = await this.frontend.requestPermission({
        id: shortId('perm'),
        turnId: ctx.turnId,
        callId,
        tool: call.name,
        args,
        reason: `${tool.risk} operation`,
      })
      this.throwIfAborted(signal)
      if (!approved) {
        const message = '(user denied permission for this tool call)'
        events.toolFailed(callId, 'permission_denied', message)
        this.appendToolMessage(ctx, call, message)
        return { outcome: 'denied' }
      }
    }

    // ---- act ----------------------------------------------------------------
    events.toolStarted(callId)
    let output: string
    let truncated = false
    try {
      const toolCtx: ToolContext = {
        cwd: this.deps.config.cwd,
        signal,
        maxOutputChars: this.deps.config.maxToolOutputChars,
        skillDirs: this.deps.skills?.roots(),
      }
      const result = await this.deps.tools.execute(call.name, args, toolCtx)
      output = result.output
      truncated = result.truncated ?? false
      events.toolCompleted(callId, output, truncated)
    } catch (err) {
      if (signal.aborted) throw new TurnAbortedError()
      const toolErr = err instanceof ToolError ? err : null
      const code = toolErr?.timeout ? 'tool_timeout' : 'tool_error'
      const message = err instanceof Error ? err.message : String(err)
      events.toolFailed(callId, code, message)
      this.appendToolMessage(ctx, call, `(error: ${message})`)
      return { outcome: 'failed' }
    }

    this.appendToolMessage(ctx, call, output)

    // ---- verify --------------------------------------------------------------
    events.verificationStarted(callId)
    const verification = await this.verify(ctx, call)
    events.verificationCompleted(callId, verification.passed, verification.note)
    return { outcome: 'completed', verification }
  }

  /**
   * Tool-free LLM judgement of the latest tool result (the tool message was
   * already appended to history). Verification is best-effort: provider
   * failures never fail the turn, they only degrade to "unverified".
   */
  private async verify(
    ctx: MicroCycleContext,
    call: ToolCallPayload,
  ): Promise<{ passed: boolean; note?: string }> {
    const messages: ChatMessage[] = [
      ...ctx.history,
      {
        role: 'user',
        content: `You are a strict verifier. The assistant just called the tool "${call.name}" and received the result above. Judge ONLY whether the result successfully served the intent of that tool call (e.g. non-zero exit codes, errors, or empty output mean it did not). Reply with ONLY a JSON object, no other text: {"passed": boolean, "note": "brief reason"}`,
      },
    ]
    try {
      const reply = await aggregateStream(
        this.deps.provider.chat({
          messages,
          maxTokens: VERIFY_MAX_TOKENS,
          signal: ctx.signal,
        }),
      )
      const verdict = extractJson(reply.content)
      if (
        verdict !== null &&
        typeof verdict === 'object' &&
        typeof (verdict as { passed?: unknown }).passed === 'boolean'
      ) {
        const v = verdict as { passed: boolean; note?: unknown }
        return {
          passed: v.passed,
          note: typeof v.note === 'string' ? v.note : undefined,
        }
      }
      return { passed: true, note: 'verification result unparseable; assumed passed' }
    } catch (err) {
      if (ctx.signal.aborted) throw new TurnAbortedError()
      this.deps.logger.warn('verification call failed', { error: String(err) })
      return { passed: true, note: 'verification unavailable; assumed passed' }
    }
  }

  private checkSchema(call: ToolCallPayload, args: Record<string, unknown>): ReviewCheck {
    const tool = this.deps.tools.get(call.name)
    if (tool === undefined) {
      return { name: 'args_schema', passed: false, detail: `unknown tool: ${call.name}` }
    }
    const parsed = tool.argsSchema.safeParse(args)
    if (parsed.success) {
      return { name: 'args_schema', passed: true, detail: 'arguments valid' }
    }
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { name: 'args_schema', passed: false, detail: `invalid arguments: ${issues}` }
  }

  private appendToolMessage(ctx: MicroCycleContext, call: ToolCallPayload, content: string): void {
    const msg: PersistableChatMessage = { role: 'tool', content, toolCallId: call.id, name: call.name }
    ctx.history.push(msg)
    ctx.onMessage?.(msg)
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new TurnAbortedError()
  }
}

/** Lenient JSON extraction: strips code fences, takes the outermost object. */
function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}
