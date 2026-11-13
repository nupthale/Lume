import type { OutboundEvent, ReviewCheck } from '@lume/protocol'

/**
 * Turn-scoped event helpers. Every event is stamped with turn_id; the sink
 * adds `ts` at emission time.
 */
export function createTurnEvents(emit: (e: OutboundEvent) => void, turnId: string) {
  return {
    started: () => emit({ type: 'turn_started', turn_id: turnId }),
    messageStarted: (messageId: string) =>
      emit({ type: 'assistant_message_started', turn_id: turnId, message_id: messageId }),
    delta: (messageId: string, delta: string) =>
      emit({ type: 'assistant_delta', turn_id: turnId, message_id: messageId, delta }),
    messageCompleted: (messageId: string, finishReason?: string) =>
      emit({
        type: 'assistant_message_completed',
        turn_id: turnId,
        message_id: messageId,
        finish_reason: finishReason,
      }),
    thought: (content: string) => emit({ type: 'thought', turn_id: turnId, content }),
    thoughtDelta: (messageId: string, delta: string) =>
      emit({ type: 'thought_delta', turn_id: turnId, message_id: messageId, delta }),
    toolCallRequested: (callId: string, tool: string, args: Record<string, unknown>) =>
      emit({ type: 'tool_call_requested', turn_id: turnId, call_id: callId, tool, args }),
    reviewStarted: (callId: string) =>
      emit({ type: 'review_started', turn_id: turnId, call_id: callId }),
    reviewCompleted: (
      callId: string,
      checks: ReviewCheck[],
      approved: boolean,
      requiresPermission: boolean,
    ) =>
      emit({
        type: 'review_completed',
        turn_id: turnId,
        call_id: callId,
        checks,
        approved,
        requires_permission: requiresPermission,
      }),
    toolStarted: (callId: string) =>
      emit({ type: 'tool_started', turn_id: turnId, call_id: callId }),
    toolCompleted: (callId: string, result: string, truncated?: boolean) =>
      emit({
        type: 'tool_completed',
        turn_id: turnId,
        call_id: callId,
        result,
        ...(truncated !== undefined ? { truncated } : {}),
      }),
    toolFailed: (callId: string, code: string, message: string) =>
      emit({
        type: 'tool_failed',
        turn_id: turnId,
        call_id: callId,
        error: { code: code as never, message },
      }),
    verificationStarted: (callId: string) =>
      emit({ type: 'verification_started', turn_id: turnId, call_id: callId }),
    verificationCompleted: (callId: string, passed: boolean, note?: string) =>
      emit({
        type: 'verification_completed',
        turn_id: turnId,
        call_id: callId,
        passed,
        ...(note !== undefined ? { note } : {}),
      }),
    completed: (finalText?: string) =>
      emit({
        type: 'turn_completed',
        turn_id: turnId,
        ...(finalText !== undefined ? { final_text: finalText } : {}),
      }),
    failed: (reason: 'aborted' | 'failed' | 'max_loops_exceeded', code: string, message: string) =>
      emit({
        type: 'turn_failed',
        turn_id: turnId,
        reason,
        error: { code: code as never, message },
      }),
  }
}

export type TurnEvents = ReturnType<typeof createTurnEvents>
