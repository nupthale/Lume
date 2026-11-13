import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import type { OutboundEvent } from '@lume/protocol'

/** compiled daemon entry the integration tests spawn */
export const daemonEntry = join(import.meta.dirname, '..', '..', 'dist', 'index.js')

/**
 * A spawned daemon driven over stdio: NDJSON protocol events out on stdout,
 * protocol messages in on stdin (one JSON object per line). Shared by the
 * integration test files.
 */
export class DaemonProc {
  private proc: ChildProcessWithoutNullStreams
  private buffer = ''
  private waiters: Array<{
    predicate: (e: OutboundEvent) => boolean
    resolve: (e: OutboundEvent) => void
  }> = []
  /** events that arrived before any matching waiter was registered */
  private pending: OutboundEvent[] = []

  /**
   * @param env environment overrides merged over process.env
   * @param args CLI arguments; defaults to stream mode. Pass e.g.
   *   `['--mode', 'stream', '--session', id]` to resume a session.
   */
  constructor(env: Record<string, string>, args: string[] = ['--mode', 'stream']) {
    this.proc = spawn(process.execPath, [daemonEntry, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', () => {}) // drain logs
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx = this.buffer.indexOf('\n')
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      if (line.trim().length === 0) {
        idx = this.buffer.indexOf('\n')
        continue
      }
      const event = JSON.parse(line) as OutboundEvent
      const waiter = this.waiters.find((w) => w.predicate(event))
      if (waiter !== undefined) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        waiter.resolve(event)
      } else {
        this.pending.push(event)
      }
      idx = this.buffer.indexOf('\n')
    }
  }

  send(msg: unknown): void {
    this.writeRaw(JSON.stringify(msg))
  }

  writeRaw(line: string): void {
    this.proc.stdin.write(`${line}\n`)
  }

  async waitExit(): Promise<number | null> {
    const [code] = (await once(this.proc, 'exit')) as [number | null]
    return code
  }

  async exit(): Promise<number | null> {
    this.proc.stdin.end()
    return this.waitExit()
  }

  waitFor(predicate: (e: OutboundEvent) => boolean, timeoutMs = 15000): Promise<OutboundEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for event')), timeoutMs)
      const settle = (e: OutboundEvent) => {
        clearTimeout(timer)
        resolve(e)
      }
      // several events can arrive in one stdout chunk while the awaiting
      // continuation has not registered the next waiter yet: re-check the
      // unconsumed backlog first instead of dropping those events
      const idx = this.pending.findIndex(predicate)
      if (idx >= 0) {
        const [event] = this.pending.splice(idx, 1)
        settle(event)
        return
      }
      this.waiters.push({ predicate, resolve: settle })
    })
  }

  kill(): void {
    this.proc.kill('SIGKILL')
  }
}
