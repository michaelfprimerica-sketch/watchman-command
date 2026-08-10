import type { QdrantIndexMemo } from './qdrant_index_memo.js'

export type ExactMatchFilter = {
  must: Array<{ key: 'source' | 'collection'; match: { value: string } }>
}

export interface CollectionPayloadClient {
  setPayload(
    collectionName: string,
    request: { payload: { collection: string | null }; filter: ExactMatchFilter }
  ): Promise<unknown>
}

export interface PayloadIndexClient {
  createPayloadIndex(
    collectionName: string,
    request: { field_name: string; field_schema: 'keyword' }
  ): Promise<unknown>
}

export interface PointCountClient {
  count(
    collectionName: string,
    request: { filter: ExactMatchFilter; exact: true }
  ): Promise<{ count: number }>
}

export const KNOWLEDGE_PAYLOAD_INDEXES = ['source', 'content_type', 'collection'] as const

/** Coalesce concurrent initialization of the same Qdrant collection. */
export class QdrantCollectionInitializationGate {
  private readonly inFlight = new Map<string, Promise<void>>()

  run(collectionName: string, initialize: () => Promise<void>): Promise<void> {
    const existing = this.inFlight.get(collectionName)
    if (existing) return existing

    // Defer initialize until after the promise is registered so a synchronous
    // second caller cannot pass the gate before the first operation is visible.
    const pending = Promise.resolve().then(initialize)
    this.inFlight.set(collectionName, pending)
    const cleanup = () => {
      if (this.inFlight.get(collectionName) === pending) this.inFlight.delete(collectionName)
    }
    void pending.then(cleanup, cleanup)
    return pending
  }
}

/** Serialize relational + Qdrant mutations in the single Watchman admin process. */
export class KnowledgeCollectionMutationQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutation, mutation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export async function ensureKnowledgePayloadIndexes(
  client: PayloadIndexClient,
  memo: QdrantIndexMemo,
  collectionName: string
): Promise<void> {
  if (memo.has(collectionName)) return
  for (const fieldName of KNOWLEDGE_PAYLOAD_INDEXES) {
    await client.createPayloadIndex(collectionName, {
      field_name: fieldName,
      field_schema: 'keyword',
    })
  }
  // Never memoize a partial attempt: any rejection above leaves this unmarked.
  memo.markVerified(collectionName)
}

export function exactCollectionFilter(collection: string): ExactMatchFilter {
  return { must: [{ key: 'collection', match: { value: collection } }] }
}

export function exactSourceFilter(source: string): ExactMatchFilter {
  return { must: [{ key: 'source', match: { value: source } }] }
}

export async function assignCollectionPayload(
  client: CollectionPayloadClient,
  qdrantCollection: string,
  source: string,
  collection: string | null
): Promise<void> {
  await client.setPayload(qdrantCollection, {
    payload: { collection },
    filter: exactSourceFilter(source),
  })
}

export async function sourceHasEmbeddedPoints(
  client: PointCountClient,
  qdrantCollection: string,
  source: string
): Promise<boolean> {
  const result = await client.count(qdrantCollection, {
    filter: exactSourceFilter(source),
    exact: true,
  })
  return result.count > 0
}

export async function renameCollectionPayload(
  client: CollectionPayloadClient,
  qdrantCollection: string,
  oldName: string,
  newName: string | null
): Promise<void> {
  await client.setPayload(qdrantCollection, {
    payload: { collection: newName },
    filter: exactCollectionFilter(oldName),
  })
}
