import {
  ERROR_CODES,
  type ErrorCode,
  type ErrorPayload,
  PROTOCOL_VERSION,
  type ReviewCheck,
  type ToolArgs,
  type ToolRisk,
  type TurnEndReason,
} from './common.js'
import { type InboundMessage, InboundMessageSchema } from './inbound.js'
import { type OutboundEvent, OutboundEventSchema } from './outbound.js'

export { InboundMessageSchema, OutboundEventSchema, ERROR_CODES, PROTOCOL_VERSION }
export type {
  InboundMessage,
  OutboundEvent,
  ErrorCode,
  ErrorPayload,
  ReviewCheck,
  ToolArgs,
  ToolRisk,
  TurnEndReason,
}

/** Serialize an outbound event as a single NDJSON line (no trailing newline). */
export function serializeEvent(event: OutboundEvent): string {
  return JSON.stringify(event)
}

/**
 * Parse one NDJSON line as an inbound message.
 * Returns `null` for blank lines; throws a ZodError for malformed payloads
 * so callers can decide whether to emit a protocol error or ignore the line.
 */
export function parseInboundMessage(line: string): InboundMessage | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  return InboundMessageSchema.parse(JSON.parse(trimmed))
}
