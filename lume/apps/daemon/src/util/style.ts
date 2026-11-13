/** Minimal ANSI styling (no dependency). */
const RESET = '\x1b[0m'

export const style = {
  bold: (s: string) => `\x1b[1m${s}${RESET}`,
  dim: (s: string) => `\x1b[2m${s}${RESET}`,
  cyan: (s: string) => `\x1b[36m${s}${RESET}`,
  yellow: (s: string) => `\x1b[33m${s}${RESET}`,
  red: (s: string) => `\x1b[31m${s}${RESET}`,
  green: (s: string) => `\x1b[32m${s}${RESET}`,
}

/** True when stdout is an interactive terminal. */
export function isTTY(): boolean {
  return process.stdout.isTTY === true
}
