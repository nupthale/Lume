import { z } from 'zod'
import {
  BaseEventSchema,
  ErrorPayloadSchema,
  PROTOCOL_VERSION,
  ReviewCheckSchema,
  ToolArgsSchema,
  TurnEndReasonSchema,
} from './common.js'

/**
 * Outbound events: daemon -> consumer, one JSON object per line on stdout.
 * The full lifecycle of one turn with a single tool call looks like:
 *
 *   turn_started
 *   assistant_message_started -> thought_delta* -> assistant_delta* -> assistant_message_completed
 *   thought?                                  (full reasoning snapshot, when present)
 *   tool_call_requested                        (think)
 *   review_started -> review_completed         (review)
 *   permission_request?                        (suspends until permission_response)
 *   tool_started -> tool_completed|tool_failed (act)
 *   verification_started -> verification_completed (verify)
 *   ... more micro cycles as decided by the model ...
 *   turn_completed | turn_failed
 */

const ReadyEventSchema = BaseEventSchema.extend({
  type: z.literal('ready'),
  protocol_version: z.literal(PROTOCOL_VERSION),
  session_id: z.string().min(1),
  model: z.string().optional(),
})

const TurnStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('turn_started'),
  turn_id: z.string().min(1),
})

const AssistantMessageStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('assistant_message_started'),
  turn_id: z.string().min(1),
  message_id: z.string().min(1),
})

const AssistantDeltaEventSchema = BaseEventSchema.extend({
  type: z.literal('assistant_delta'),
  turn_id: z.string().min(1),
  message_id: z.string().min(1),
  delta: z.string(),
})

const AssistantMessageCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('assistant_message_completed'),
  turn_id: z.string().min(1),
  message_id: z.string().min(1),
  finish_reason: z.string().optional(),
})

const ThoughtEventSchema = BaseEventSchema.extend({
  type: z.literal('thought'),
  turn_id: z.string().min(1),
  content: z.string(),
})

const ThoughtDeltaEventSchema = BaseEventSchema.extend({
  type: z.literal('thought_delta'),
  turn_id: z.string().min(1),
  message_id: z.string().min(1).optional(),
  delta: z.string(),
})

const ToolCallRequestedEventSchema = BaseEventSchema.extend({
  type: z.literal('tool_call_requested'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
  tool: z.string().min(1),
  args: ToolArgsSchema,
})

const ReviewStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('review_started'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
})

const ReviewCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('review_completed'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
  checks: z.array(ReviewCheckSchema),
  /** true when the call may proceed to execution */
  approved: z.boolean(),
  /** true when the call additionally requires explicit human permission */
  requires_permission: z.boolean(),
})

const PermissionRequestEventSchema = BaseEventSchema.extend({
  type: z.literal('permission_request'),
  turn_id: z.string().min(1),
  /** id the consumer must echo back in `permission_response` */
  id: z.string().min(1),
  call_id: z.string().min(1),
  tool: z.string().min(1),
  args: ToolArgsSchema,
  reason: z.string().optional(),
})

const ToolStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('tool_started'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
})

const ToolCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('tool_completed'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
  /** tool output (possibly truncated by the daemon) */
  result: z.string(),
  truncated: z.boolean().optional(),
})

const ToolFailedEventSchema = BaseEventSchema.extend({
  type: z.literal('tool_failed'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
  error: ErrorPayloadSchema,
})

const VerificationStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('verification_started'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
})

const VerificationCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('verification_completed'),
  turn_id: z.string().min(1),
  call_id: z.string().min(1),
  passed: z.boolean(),
  note: z.string().optional(),
})

const TurnCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('turn_completed'),
  turn_id: z.string().min(1),
  /** final assistant text of the turn, when one was produced */
  final_text: z.string().optional(),
})

const TurnFailedEventSchema = BaseEventSchema.extend({
  type: z.literal('turn_failed'),
  turn_id: z.string().min(1),
  reason: TurnEndReasonSchema,
  error: ErrorPayloadSchema,
})

const UserMessageQueuedEventSchema = BaseEventSchema.extend({
  type: z.literal('user_message_queued'),
  queue_length: z.number().int().positive(),
})

const ErrorEventSchema = BaseEventSchema.extend({
  type: z.literal('error'),
  error: ErrorPayloadSchema,
  turn_id: z.string().min(1).optional(),
  /** fatal errors mean the daemon is about to exit */
  fatal: z.boolean().default(false),
})

export const OutboundEventSchema = z.discriminatedUnion('type', [
  ReadyEventSchema,
  TurnStartedEventSchema,
  AssistantMessageStartedEventSchema,
  AssistantDeltaEventSchema,
  AssistantMessageCompletedEventSchema,
  ThoughtEventSchema,
  ThoughtDeltaEventSchema,
  ToolCallRequestedEventSchema,
  ReviewStartedEventSchema,
  ReviewCompletedEventSchema,
  PermissionRequestEventSchema,
  ToolStartedEventSchema,
  ToolCompletedEventSchema,
  ToolFailedEventSchema,
  VerificationStartedEventSchema,
  VerificationCompletedEventSchema,
  TurnCompletedEventSchema,
  TurnFailedEventSchema,
  UserMessageQueuedEventSchema,
  ErrorEventSchema,
])

export type OutboundEvent = z.infer<typeof OutboundEventSchema>
