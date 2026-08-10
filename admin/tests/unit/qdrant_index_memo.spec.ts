import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { QdrantIndexMemo } from '../../app/utils/qdrant_index_memo.js'

describe('Qdrant payload index verification memo', () => {
  it('memoizes an existing collection after successful verification', () => {
    const memo = new QdrantIndexMemo()
    assert.equal(memo.has('watchman_knowledge_base'), false)
    memo.markVerified('watchman_knowledge_base')
    assert.equal(memo.has('watchman_knowledge_base'), true)
  })

  it('clears all verification after a Qdrant restart or health failure', () => {
    const memo = new QdrantIndexMemo()
    memo.markVerified('watchman_knowledge_base')
    memo.markVerified('another_collection')
    memo.reset()
    assert.equal(memo.has('watchman_knowledge_base'), false)
    assert.equal(memo.has('another_collection'), false)
  })

  it('invalidates only the collection deleted during reset', () => {
    const memo = new QdrantIndexMemo()
    memo.markVerified('watchman_knowledge_base')
    memo.markVerified('another_collection')
    memo.invalidate('watchman_knowledge_base')
    assert.equal(memo.has('watchman_knowledge_base'), false)
    assert.equal(memo.has('another_collection'), true)
  })
})
