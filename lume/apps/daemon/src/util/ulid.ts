/**
 * ULID generator, hand-rolled (no third-party dependency).
 *
 * Layout: 26 chars of Crockford base32 = 10 chars of millisecond timestamp
 * (48 bits, left-padded) + 16 chars of randomness (80 bits).
 *
 * Same-millisecond calls carry-increment the random part, so the ids one
 * process emits are strictly increasing in both time and lexicographic order.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let lastTime = -1
/** random part kept as base32 digit indices so it can be incremented in place */
const randomDigits: number[] = new Array<number>(16).fill(0)

export function ulid(): string {
  let now = Date.now()
  if (now !== lastTime) {
    fillRandom()
  } else if (incrementRandom()) {
    // rare: the 80-bit random part overflowed within one millisecond;
    // wait for the next millisecond and start from fresh randomness
    do {
      now = Date.now()
    } while (now === lastTime)
    fillRandom()
  }
  lastTime = now
  return encodeTime(now) + encodeRandom()
}

function fillRandom(): void {
  for (let i = 0; i < randomDigits.length; i++) {
    randomDigits[i] = Math.floor(Math.random() * 32)
  }
}

/** carry-increment the random part; true when every digit overflowed */
function incrementRandom(): boolean {
  for (let i = randomDigits.length - 1; i >= 0; i--) {
    if (randomDigits[i]! < 31) {
      randomDigits[i]!++
      return false
    }
    randomDigits[i] = 0
  }
  return true
}

/** 48-bit millisecond timestamp -> exactly 10 base32 chars */
function encodeTime(ms: number): string {
  let time = ms
  let out = ''
  for (let i = 0; i < 10; i++) {
    out = ENCODING.charAt(time % 32) + out
    time = Math.floor(time / 32)
  }
  return out
}

function encodeRandom(): string {
  let out = ''
  for (let i = 0; i < randomDigits.length; i++) out += ENCODING.charAt(randomDigits[i]!)
  return out
}
