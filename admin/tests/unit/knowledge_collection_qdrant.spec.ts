import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assignCollectionPayload,
  ensureKnowledgePayloadIndexes,
  exactCollectionFilter,
  renameCollectionPayload,
  sourceHasEmbeddedPoints,
} from '../../app/utils/knowledge_collection_qdrant.js'
import { QdrantIndexMemo } from '../../app/utils/qdrant_index_memo.js'

describe('Knowledge Collection Qdrant contract', () => {
  it('uses literal exact-match filters and cannot broaden cross-collection retrieval', () => {
    assert.deepEqual(exactCollectionFilter('alpha" }], must_not: [{ "'), {
      must: [{ key: 'collection', match: { value: 'alpha" }], must_not: [{ "' } }],
    })
  })

  it('assigns, renames, and removes payload labels without replacing vectors', async () => {
    const calls: unknown[] = []
    const client = {
      async setPayload(collectionName: string, request: unknown) {
        calls.push({ collectionName, request })
      },
    }

    await assignCollectionPayload(client, 'knowledge', '/data/guide.zim', 'field guides')
    await renameCollectionPayload(client, 'knowledge', 'field guides', 'reference')
    await renameCollectionPayload(client, 'knowledge', 'reference', null)

    assert.deepEqual(calls, [
      {
        collectionName: 'knowledge',
        request: {
          payload: { collection: 'field guides' },
          filter: { must: [{ key: 'source', match: { value: '/data/guide.zim' } }] },
        },
      },
      {
        collectionName: 'knowledge',
        request: {
          payload: { collection: 'reference' },
          filter: { must: [{ key: 'collection', match: { value: 'field guides' } }] },
        },
      },
      {
        collectionName: 'knowledge',
        request: {
          payload: { collection: null },
          filter: { must: [{ key: 'collection', match: { value: 'reference' } }] },
        },
      },
    ])
    assert.equal(JSON.stringify(calls).includes('vector'), false)
  })

  it('propagates unavailable-Qdrant failures to prevent false success', async () => {
    const unavailable = {
      async setPayload() {
        throw new Error('connection refused')
      },
    }
    await assert.rejects(
      assignCollectionPayload(unavailable, 'knowledge', '/data/guide.zim', 'reference'),
      /connection refused/
    )
  })

  it('requires an exact existing source before a legacy Qdrant-only row can be persisted', async () => {
    const requests: unknown[] = []
    const client = {
      async count(collectionName: string, request: unknown) {
        requests.push({ collectionName, request })
        return { count: collectionName === 'knowledge' ? 1 : 0 }
      },
    }
    assert.equal(await sourceHasEmbeddedPoints(client, 'knowledge', '/data/known.zim'), true)
    assert.equal(await sourceHasEmbeddedPoints(client, 'missing', '/data/unknown.zim'), false)
    assert.deepEqual(requests[0], {
      collectionName: 'knowledge',
      request: {
        filter: { must: [{ key: 'source', match: { value: '/data/known.zim' } }] },
        exact: true,
      },
    })
  })

  it('does not memoize partial payload-index creation and retries cleanly', async () => {
    const memo = new QdrantIndexMemo()
    let attempts = 0
    const partialFailure = {
      async createPayloadIndex(_collectionName: string, request: { field_name: string }) {
        attempts++
        if (request.field_name === 'collection') throw new Error('index unavailable')
      },
    }

    await assert.rejects(
      ensureKnowledgePayloadIndexes(partialFailure, memo, 'knowledge'),
      /index unavailable/
    )
    assert.equal(memo.has('knowledge'), false)

    const fields: string[] = []
    await ensureKnowledgePayloadIndexes(
      {
        async createPayloadIndex(_collectionName, request) {
          fields.push(request.field_name)
        },
      },
      memo,
      'knowledge'
    )
    assert.deepEqual(fields, ['source', 'content_type', 'collection'])
    assert.equal(memo.has('knowledge'), true)
    assert.equal(attempts, 3)
  })

  it('invalidates on restart/reset so every payload index is verified again', async () => {
    const memo = new QdrantIndexMemo()
    const fields: string[] = []
    const client = {
      async createPayloadIndex(_collectionName: string, request: { field_name: string }) {
        fields.push(request.field_name)
      },
    }
    await ensureKnowledgePayloadIndexes(client, memo, 'knowledge')
    await ensureKnowledgePayloadIndexes(client, memo, 'knowledge')
    assert.equal(fields.length, 3)

    memo.invalidate('knowledge')
    await ensureKnowledgePayloadIndexes(client, memo, 'knowledge')
    assert.equal(fields.length, 6)

    memo.reset()
    await ensureKnowledgePayloadIndexes(client, memo, 'knowledge')
    assert.equal(fields.length, 9)
  })
})
