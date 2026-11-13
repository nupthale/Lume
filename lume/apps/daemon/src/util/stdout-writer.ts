/**
 * NDJSON writer for stdout with backpressure handling.
 * stream-json mode owns stdout exclusively: only protocol lines ever go out.
 */
export class LineWriter {
  private readonly queue: string[] = []
  private writing = false
  private closed = false

  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {}

  writeLine(obj: unknown): void {
    if (this.closed) return
    this.queue.push(JSON.stringify(obj))
    void this.drain()
  }

  /** Flush pending lines and resolve once the stream is drained. */
  flush(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && !this.writing) {
          this.stream.write('', () => resolve())
        } else {
          setTimeout(check, 5)
        }
      }
      check()
    })
  }

  close(): void {
    this.closed = true
  }

  private async drain(): Promise<void> {
    if (this.writing) return
    this.writing = true
    try {
      while (this.queue.length > 0 && !this.closed) {
        const line = this.queue.shift()
        if (line === undefined) break
        await this.writeWithBackpressure(`${line}\n`)
      }
    } finally {
      this.writing = false
    }
  }

  private writeWithBackpressure(data: string): Promise<void> {
    return new Promise((resolve) => {
      const ok = this.stream.write(data)
      if (ok) {
        resolve()
        return
      }
      this.stream.once('drain', () => resolve())
    })
  }
}
