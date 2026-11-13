import { randomUUID } from 'node:crypto'

/** Short readable id with a prefix, e.g. `turn_x8k2ma1q`. */
export function shortId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
}
