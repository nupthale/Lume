import { describe, expect, it } from 'vitest'
import {
  type OutboundEvent,
  OutboundEventSchema,
  PROTOCOL_VERSION,
  parseInboundMessage,
  serializeEvent,
} from '../src/index.js'

describe('protocol round-trip', () => {
  it('serializes and re-validates every representative event', () => {
    const events: OutboundEvent[] = [
      { type: 'ready', protocol_version: PROTOCOL_VERSION, session_id: 's1' },
      { type: 'turn_started', turn_id: 't1' },
      { type: 'assistant_delta', turn_id: 't1', message_id: 'm1', delta: 'hello' },
      { type: 'thought', turn_id: 't1', content: 'thinking...' },
      {
        type: 'tool_call_requested',
        turn_id: 't1',
        call_id: 'c1',
        tool: 'bash',
        args: { command: 'ls' },
      },
      {
        type: 'review_completed',
        turn_id: 't1',
        call_id: 'c1',
        checks: [{ name: 'bash_safety', passed: true, detail: 'ok' }],
        approved: true,
        requires_permission: true,
      },
      {
        type: 'permission_request',
        turn_id: 't1',
        id: 'p1',
        call_id: 'c1',
        tool: 'bash',
        args: {},
      },
      { type: 'tool_completed', turn_id: 't1', call_id: 'c1', result: 'file.txt\n' },
      {
        type: 'tool_failed',
        turn_id: 't1',
        call_id: 'c1',
        error: { code: 'tool_error', message: 'boom' },
      },
      {
        type: 'verification_completed',
        turn_id: 't1',
        call_id: 'c1',
        passed: false,
        note: 'exit 1',
      },
      { type: 'turn_completed', turn_id: 't1', final_text: 'done' },
      {
        type: 'turn_failed',
        turn_id: 't1',
        reason: 'aborted',
        error: { code: 'aborted', message: 'user aborted' },
      },
      { type: 'user_message_queued', queue_length: 2 },
      { type: 'error', error: { code: 'internal_error', message: 'x' }, fatal: false },
    ]
    for (const event of events) {
      const parsed = OutboundEventSchema.parse(JSON.parse(serializeEvent(event)))
      expect(parsed.type).toBe(event.type)
    }
  })

  it('rejects malformed outbound events', () => {
    expect(OutboundEventSchema.safeParse({ type: 'turn_started' }).success).toBe(false)
    expect(
      OutboundEventSchema.safeParse({ type: 'tool_completed', turn_id: 't', call_id: 'c' }).success,
    ).toBe(false)
  })

  it('parses valid inbound messages and rejects unknown types', () => {
    expect(parseInboundMessage('')).toBeNull()
    expect(parseInboundMessage('   ')).toBeNull()
    expect(parseInboundMessage('{"type":"user_message","content":"hi"}')).toEqual({
      type: 'user_message',
      content: 'hi',
    })
    expect(parseInboundMessage('{"type":"shutdown"}')).toEqual({ type: 'shutdown' })
    expect(() => parseInboundMessage('{"type":"nonsense"}')).toThrow()
    expect(() => parseInboundMessage('not json')).toThrow()
  })

  it('rejects an empty user message', () => {
    expect(() => parseInboundMessage('{"type":"user_message","content":""}')).toThrow()
  })
})
