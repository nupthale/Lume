/**
 * Structured logger for the daemon.
 *
 * HARD RULE: in stream-json mode stdout is reserved exclusively for the
 * protocol. All logging must go to stderr (or the void when silenced).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const minOrder = LEVEL_ORDER[minLevel]
  const write = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < minOrder) return
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...data,
    })
    process.stderr.write(`${line}\n`)
  }
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  }
}
