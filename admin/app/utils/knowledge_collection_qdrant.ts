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

export const KNOWLEDGE_PAYLOAD_INDEXES = ['source', 'content_type', 'collection'] as const

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
