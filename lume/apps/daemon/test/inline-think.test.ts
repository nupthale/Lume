import { describe, expect, it } from 'vitest'
import { InlineThinkSplitter } from '../src/providers/inline-think.js'

function run(chunks: string[]) {
  const splitter = new InlineThinkSplitter()
  const pieces: Array<{ kind: string; value: string }> = []
  const push = (list: Array<{ kind: string; value: string }>) => {
    for (const p of list) {
      const last = pieces.at(-1)
      if (last !== undefined && last.kind === p.kind) last.value += p.value
      else pieces.push({ ...p })
    }
  }
  for (const c of chunks) push(splitter.push(c))
  push(splitter.end())
  return pieces.map((p) => `${p.kind}:${p.value}`).join('|')
}

describe('InlineThinkSplitter (qwen3 inline reasoning compatibility)', () => {
  const OPEN = '<' + 'think' + '>'
  const CLOSE = '<' + '/think' + '>'

  it('classifies a think-tagged prefix as reasoning and the rest as text', () => {
    expect(run([`${OPEN}internal${CLOSE}answer`])).toBe('reasoning:internal|text:answer')
  })

  it('keeps plain content as text', () => {
    expect(run(['just ', 'a normal reply'])).toBe('text:just a normal reply')
  })

  it('handles the opening tag split across chunks', () => {
    expect(run(['<thi', 'nk>planning', CLOSE, 'final'])).toBe('reasoning:planning|text:final')
  })

  it('does not misclassify content that merely contains the tag later', () => {
    expect(run([`use ${OPEN} literally in prose`])).toBe(`text:use ${OPEN} literally in prose`)
  })

  it('treats an unterminated think block as reasoning', () => {
    expect(run([`${OPEN}half thought`])).toBe('reasoning:half thought')
  })

  it('handles the close tag split across chunks', () => {
    expect(run([`${OPEN}x</thi`, 'nk>tail'])).toBe('reasoning:x|text:tail')
  })
})
