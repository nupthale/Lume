import type { ToolRisk } from '@lume/protocol'

/**
 * Permission policy: decides whether a tool call needs explicit human
 * approval before execution.
 *
 * Defaults: `read` tools are auto-approved; `write` and `execute` tools
 * require approval. `autoApproveTools` names individual tools that skip
 * the human gate regardless of risk.
 */
export class PermissionPolicy {
  private readonly autoApproved: Set<string>

  constructor(autoApproveTools: string[] = []) {
    this.autoApproved = new Set(autoApproveTools)
  }

  requiresApproval(toolName: string, risk: ToolRisk): boolean {
    if (this.autoApproved.has(toolName)) return false
    return risk === 'write' || risk === 'execute'
  }
}

/**
 * Suspension manager for permission requests: stores the continuation of
 * each suspended agent loop (id -> resolve) and resumes it when the
 * corresponding response arrives. Skins (stream-json / REPL) both delegate
 * to this; only the transport differs.
 */
export class PermissionManager {
  private readonly pending = new Map<string, (approve: boolean) => void>()

  suspend(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, resolve)
    })
  }

  /** Resolve a suspended request. Returns false when the id is unknown/stale. */
  respond(id: string, approve: boolean): boolean {
    const resolve = this.pending.get(id)
    if (resolve === undefined) return false
    this.pending.delete(id)
    resolve(approve)
    return true
  }

  /** Resolve everything as denied (shutdown / interrupt path). */
  rejectAll(): void {
    for (const resolve of this.pending.values()) resolve(false)
    this.pending.clear()
  }

  get pendingCount(): number {
    return this.pending.size
  }
}
