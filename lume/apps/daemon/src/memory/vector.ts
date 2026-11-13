/**
 * Vector helpers for Layer 3 semantic memory.
 *
 * Embeddings are persisted as little-endian float32 BLOBs (the `facts.embedding`
 * column); these helpers convert between number[] and that wire format and
 * score similarity. Retrieval v1 is an in-library brute-force cosine scan over
 * all facts, so a plain loop is all that is needed here.
 */

export function encodeFloat32(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4)
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i]!, i * 4)
  }
  return buf
}

export function decodeFloat32(buf: Buffer): number[] {
  const out: number[] = []
  for (let offset = 0; offset + 4 <= buf.length; offset += 4) {
    out.push(buf.readFloatLE(offset))
  }
  return out
}

/** Cosine similarity; a zero vector has no direction, so it scores 0. */
export function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
