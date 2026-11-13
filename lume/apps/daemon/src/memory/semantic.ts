import { ulid } from '../util/ulid.js'
import type { EmbeddingClient } from './embedding.js'
import type { MemoryStore } from './store.js'
import { cosine, decodeFloat32, encodeFloat32 } from './vector.js'

/** similarity above which a new fact is treated as a duplicate of an existing one */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.92

/** default similarity a fact must score against the turn query to be recalled */
export const DEFAULT_RECALL_MIN_SIM = 0.35

/** default number of facts recalled per turn */
export const DEFAULT_RECALL_TOP_K = 5

export interface SemanticDeps {
  embedder: EmbeddingClient
  store: MemoryStore
}

export interface SaveFactResult {
  saved: boolean
  reason: 'duplicate' | 'saved'
  /** content of the closest existing fact, set when reason === 'duplicate' */
  similarTo?: string
}

/**
 * Layer 3 write path: embed the fact, then de-duplicate against every stored
 * fact that carries an embedding (facts saved while Layer 3 was disabled have
 * NULL embeddings and never match). A near-identical fact (cosine > 0.92) is
 * skipped instead of stored twice.
 */
export async function saveFact(
  deps: SemanticDeps,
  input: { content: string; sessionId: string },
): Promise<SaveFactResult> {
  const vec = await deps.embedder.embed(input.content)

  let bestSim = 0
  let bestContent = ''
  for (const fact of deps.store.listFacts()) {
    if (fact.embedding === null) continue
    const sim = cosine(vec, decodeFloat32(fact.embedding))
    if (sim > bestSim) {
      bestSim = sim
      bestContent = fact.content
    }
  }
  if (bestSim > DUPLICATE_SIMILARITY_THRESHOLD) {
    return { saved: false, reason: 'duplicate', similarTo: bestContent }
  }

  deps.store.insertFact({
    id: ulid(),
    content: input.content,
    embedding: encodeFloat32(vec),
    sessionId: input.sessionId,
  })
  return { saved: true, reason: 'saved' }
}

/**
 * Layer 3 read path: embed the query and return the top-K most similar fact
 * contents, descending. An empty embedding library returns [] before the embed
 * call (saves the round-trip latency every turn); NULL-embedding facts are
 * ignored. v1 scans the whole library in-memory — the swap point for a real
 * vector index is isolated behind the store.
 */
export async function recallFacts(
  deps: SemanticDeps,
  query: string,
  opts: { topK?: number; minSim?: number } = {},
): Promise<string[]> {
  const topK = opts.topK ?? DEFAULT_RECALL_TOP_K
  const minSim = opts.minSim ?? DEFAULT_RECALL_MIN_SIM

  const facts = deps.store.listFacts().filter((f) => f.embedding !== null)
  if (facts.length === 0) return []

  const queryVec = await deps.embedder.embed(query)
  const scored = facts.map((fact) => ({
    content: fact.content,
    sim: cosine(queryVec, decodeFloat32(fact.embedding!)),
  }))
  scored.sort((a, b) => b.sim - a.sim)
  return scored
    .filter((s) => s.sim > minSim)
    .slice(0, topK)
    .map((s) => s.content)
}
