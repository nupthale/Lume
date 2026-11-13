import { z } from 'zod'

/**
 * Inbound messages: consumer -> daemon, one JSON object per line on stdin.
 */
export const InboundMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user_message'),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('permission_response'),
    /** the id received on `permission_request` */
    id: z.string().min(1),
    approve: z.boolean(),
  }),
  z.object({
    type: z.literal('interrupt'),
    /** optional: only abort if this is the current turn */
    turn_id: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('shutdown') }),
])

export type InboundMessage = z.infer<typeof InboundMessageSchema>
