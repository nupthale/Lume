import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssistantReply, ChatOptions, LlmProvider, ProviderChunk } from './types.js'

/**
 * Scripted provider for tests and smoke runs (LUME_PROVIDER=fake).
 *
 * `script` is consumed one reply per chat() call; when exhausted, calls fail.
 * If a script entry is a function, it receives the pending messages so tests
 * can react to tool results (e.g. emit a verification verdict).
 *
 * Test hook: when LUME_FAKE_CAPTURE_DIR is set, every chat() call dumps the
 * request messages to `<dir>/chat-<n>.json` (1-based call order) so
 * integration tests can assert exactly what the provider saw.
 */
export type FakeReply = AssistantReply | ((messages: ChatOptions['messages']) => AssistantReply)

export class FakeProvider implements LlmProvider {
  readonly name = 'fake'
  private readonly script: FakeReply[]
  private callIndex = 0
  /** directory to dump request messages into; undefined = capture disabled */
  private readonly captureDir: string | undefined

  constructor(script: FakeReply[]) {
    this.script = [...script]
    const captureDir = process.env.LUME_FAKE_CAPTURE_DIR
    if (captureDir !== undefined && captureDir !== '') {
      mkdirSync(captureDir, { recursive: true })
      this.captureDir = captureDir
    }
  }

  async *chat(options: ChatOptions): AsyncIterable<ProviderChunk> {
    if (this.captureDir !== undefined) {
      writeFileSync(
        join(this.captureDir, `chat-${this.callIndex + 1}.json`),
        JSON.stringify(options.messages),
      )
    }
    const entry = this.script.shift()
    if (entry === undefined) {
      throw new Error(`FakeProvider: script exhausted at call #${this.callIndex}`)
    }
    const reply = typeof entry === 'function' ? entry(options.messages) : entry
    this.callIndex++

    // emulate streaming: emit content in small chunks
    for (const delta of chunkString(reply.content, 16)) {
      yield { type: 'text_delta', delta }
    }
    for (const delta of chunkString(reply.reasoning, 16)) {
      yield { type: 'reasoning_delta', delta }
    }
    for (let i = 0; i < reply.toolCalls.length; i++) {
      const tc = reply.toolCalls[i]
      if (!tc) continue
      yield { type: 'tool_call_delta', index: i, id: tc.id, name: tc.name }
      for (const args of chunkString(tc.arguments, 12)) {
        yield { type: 'tool_call_delta', index: i, argumentsDelta: args }
      }
    }
    yield { type: 'done', finishReason: reply.finishReason ?? 'stop' }
  }
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}
