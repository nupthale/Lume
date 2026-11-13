import { z } from 'zod'

/** Protocol version carried on the `ready` event. Bump on breaking changes. */
export const PROTOCOL_VERSION = 1

/**
 * Error codes used across the protocol.
 * - `config_error` / `provider_error` / `internal_error` are fatal for the process
 * - everything else is recoverable within a turn
 */
export const ERROR_CODES = [
  'config_error',
  'provider_error',
  'provider_timeout',
  'protocol_error',
  'tool_error',
  'tool_timeout',
  'permission_denied',
  'safety_blocked',
  'max_loops_exceeded',
  'aborted',
  'internal_error',
] as const

export const ErrorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

/** Why a turn stopped (surfaced on turn_completed / turn_failed). */
export const TurnEndReasonSchema = z.enum(['completed', 'aborted', 'failed', 'max_loops_exceeded'])
export type TurnEndReason = z.infer<typeof TurnEndReasonSchema>

/** Tool risk classification driving the default permission policy. */
export const ToolRiskSchema = z.enum(['read', 'write', 'execute'])
export type ToolRisk = z.infer<typeof ToolRiskSchema>

/** Structured error payload embedded in failure events. */
export const ErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
})
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>

/** A single named check performed during the review phase. */
export const ReviewCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string(),
})
export type ReviewCheck = z.infer<typeof ReviewCheckSchema>

/** JSON-schema-ish argument bag for tool calls (validated per-tool by the daemon). */
export const ToolArgsSchema = z.record(z.unknown())
export type ToolArgs = z.infer<typeof ToolArgsSchema>

/** Envelope shared by every outbound event. */
export const BaseEventSchema = z.object({
  /** Emitter timestamp (ms since epoch). Filled by the daemon before serialization. */
  ts: z.number().int().nonnegative().optional(),
})

export type BaseEvent = z.infer<typeof BaseEventSchema>
