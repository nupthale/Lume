/**
 * Splits LLM content that inlines think-tag reasoning (e.g. Xinference qwen3
 * serves reasoning as a content prefix wrapped in think tags) into separate
 * reasoning/text streams. Providers exposing a native reasoning_content field
 * or plain content are unaffected (no opening tag at stream start).
 *
 * Feed chunks via `push()`; each call returns classified pieces. Call `end()`
 * to flush any remainder.
 */

type Piece = { kind: 'reasoning' | 'text'; value: string }

// constructed via concatenation on purpose
const OPEN = '<' + 'think' + '>'
const CLOSE = '<' + '/think' + '>'

export class InlineThinkSplitter {
  private state: 'detect' | 'reasoning' | 'text' = 'detect'
  private buf = ''

  push(chunk: string): Piece[] {
    if (chunk.length === 0) return []
    this.buf += chunk
    const out: Piece[] = []

    for (;;) {
      if (this.state === 'detect') {
        if (this.buf.length < OPEN.length && OPEN.startsWith(this.buf)) {
          // still ambiguous: could become the opening tag, wait for more input
          return out
        }
        if (this.buf.startsWith(OPEN)) {
          this.state = 'reasoning'
          this.buf = this.buf.slice(OPEN.length)
        } else {
          this.state = 'text'
        }
      }

      if (this.state === 'reasoning') {
        const idx = this.buf.indexOf(CLOSE)
        if (idx >= 0) {
          if (idx > 0) out.push({ kind: 'reasoning', value: this.buf.slice(0, idx) })
          this.buf = this.buf.slice(idx + CLOSE.length)
          this.state = 'text'
          continue
        }
        // emit everything except a possible trailing partial close tag
        const safeLen = this.safePrefixLength(this.buf, CLOSE)
        if (safeLen > 0) {
          out.push({ kind: 'reasoning', value: this.buf.slice(0, safeLen) })
          this.buf = this.buf.slice(safeLen)
        }
        return out
      }

      // text state: pass through
      if (this.buf.length > 0) {
        out.push({ kind: 'text', value: this.buf })
        this.buf = ''
      }
      return out
    }
  }

  end(): Piece[] {
    const out: Piece[] = []
    if (this.buf.length > 0) {
      // unterminated think block: treat remainder as reasoning
      const kind = this.state === 'reasoning' ? 'reasoning' : 'text'
      out.push({ kind, value: this.buf })
    }
    this.buf = ''
    return out
  }

  /** Length of the prefix of `s` after removing the longest suffix that could
   *  still grow into `marker` (e.g. a partial closing tag). */
  private safePrefixLength(s: string, marker: string): number {
    const maxKeep = Math.min(marker.length - 1, s.length)
    for (let keep = maxKeep; keep > 0; keep--) {
      if (marker.startsWith(s.slice(-keep))) return s.length - keep
    }
    return s.length
  }
}
