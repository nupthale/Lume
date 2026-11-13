import type { OutboundEvent } from '@lume/protocol'

/**
 * The ONLY way the agent core talks to the outside world.
 *
 * Core discipline (enforced by design):
 * - all output flows through `emit` (never console.log / process.stdout)
 * - all human interaction is suspendable via `requestPermission`
 *   (the core awaits the returned Promise and knows nothing about how the
 *   answer is obtained: terminal y/n, GUI dialog, ...)
 * - the process never decides to exit on its own; exit is driven by the
 *   skin/frontend layer (EOF, signal, shutdown message)
 */
export interface Frontend {
  emit(event: OutboundEvent): void
  /**
   * Ask a human whether a tool call may proceed. Resolves once answered.
   * Implementations MUST emit a `permission_request` event and suspend.
   */
  requestPermission(req: {
    id: string
    turnId: string
    callId: string
    tool: string
    args: Record<string, unknown>
    reason?: string
  }): Promise<boolean>
}

/** Convenience wrapper that stamps `ts` on every event. */
export function makeEventSink(frontend: Frontend) {
  return (event: OutboundEvent): void => {
    frontend.emit(event.ts === undefined ? { ...event, ts: Date.now() } : event)
  }
}
