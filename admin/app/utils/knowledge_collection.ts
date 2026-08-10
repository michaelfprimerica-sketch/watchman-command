export const KNOWLEDGE_COLLECTION_MAX_LENGTH = 64

/**
 * Normalize an untrusted generic Knowledge Collection name.
 *
 * Collections are deliberately separate from future signed Watchman Knowledge
 * Pack metadata. They are lightweight, user-defined labels only.
 */
export function normalizeKnowledgeCollection(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
  if (normalized.length === 0) return null
  if (Array.from(normalized).length > KNOWLEDGE_COLLECTION_MAX_LENGTH) {
    throw new RangeError(
      `Collection names must be ${KNOWLEDGE_COLLECTION_MAX_LENGTH} characters or fewer`
    )
  }

  return normalized
}

/** Preserve a durable pre-index assignment unless the dispatched job overrides it. */
export function resolveEffectiveCollection(
  dispatched: string | undefined,
  durable: string | null | undefined
): string | undefined {
  return dispatched ?? durable ?? undefined
}
