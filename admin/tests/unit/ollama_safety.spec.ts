import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  hasNativeReasoning,
  normalizeCompleteReasoning,
  SafeReasoningStreamNormalizer,
} from '../../app/utils/reasoning_privacy.js'
import { abortOnClientClose } from '../../app/utils/request_abort.js'
import {
  hasUsableRecommendedModels,
  isUsableModelCatalogCache,
  ModelCapabilityCache,
} from '../../app/utils/model_catalog.js'

describe('Ollama reasoning privacy', () => {
  it('recognizes native and OpenAI-compatible reasoning fields without returning their text', () => {
    assert.equal(hasNativeReasoning({ thinking: 'private native thought' }), true)
    assert.equal(hasNativeReasoning({ reasoning: 'private OpenAI thought' }), true)
    assert.equal(hasNativeReasoning({ content: 'answer only' }), false)

    const normalizer = new SafeReasoningStreamNormalizer()
    const chunk = normalizer.push('answer', { reasoning: 'secret and private RAG context' })
    assert.deepEqual(chunk, { content: 'answer', reasoningActive: true })
    assert.doesNotMatch(JSON.stringify(chunk), /secret|private RAG/)
  })

  it('removes chain-of-thought tags split across stream chunks', () => {
    const normalizer = new SafeReasoningStreamNormalizer()
    const chunks = [
      normalizer.push('Before <thi'),
      normalizer.push('nk>system prompt and tool secret'),
      normalizer.push('</thi'),
      normalizer.push('nk>After'),
      normalizer.finish(),
    ]
    assert.equal(chunks.map((chunk) => chunk.content).join(''), 'Before After')
    assert.equal(
      chunks.some((chunk) => chunk.reasoningActive),
      true
    )
    assert.doesNotMatch(JSON.stringify(chunks), /system prompt|tool secret/)
  })

  it('passes through content unchanged for a no-thinking model', () => {
    const normalizer = new SafeReasoningStreamNormalizer()
    assert.deepEqual(normalizer.push('ordinary answer'), {
      content: 'ordinary answer',
      reasoningActive: false,
    })
  })

  it('removes inline reasoning from complete non-streaming responses', () => {
    const result = normalizeCompleteReasoning(
      '<think>system prompt and private context</think>Final answer',
      { reasoning: 'provider-private reasoning' }
    )
    assert.deepEqual(result, { content: 'Final answer', reasoningActive: true })
    assert.doesNotMatch(JSON.stringify(result), /system prompt|private context|provider-private/)
  })
})

describe('Ollama disconnect cancellation', () => {
  it('aborts generation on close and removes the listener when disposed', () => {
    const first = new EventEmitter()
    const lifetime = abortOnClientClose(first)
    first.emit('close')
    assert.equal(lifetime.signal.aborted, true)

    const second = new EventEmitter()
    const disposed = abortOnClientClose(second)
    disposed.dispose()
    second.emit('close')
    assert.equal(disposed.signal.aborted, false)
  })

  it('is already aborted when the response closed before listener registration', () => {
    const alreadyClosed = Object.assign(new EventEmitter(), { destroyed: true })
    const lifetime = abortOnClientClose(alreadyClosed)
    assert.equal(lifetime.signal.aborted, true)
    assert.equal(alreadyClosed.listenerCount('close'), 0)
  })
})

describe('recommended model fallback', () => {
  it('falls back for timeout/malformed empty results and never accepts an empty cache', () => {
    assert.equal(hasUsableRecommendedModels(null), false)
    assert.equal(hasUsableRecommendedModels([]), false)
    assert.equal(hasUsableRecommendedModels([{ name: 'model' }]), true)
    assert.equal(isUsableModelCatalogCache({ models: [] }), false)
    assert.equal(isUsableModelCatalogCache([]), false)
    assert.equal(isUsableModelCatalogCache([{ name: 'model' }]), true)
  })

  it('uses a bounded catalog request and does not log malformed response bodies', async () => {
    const source = await readFile(
      new URL('../../app/services/ollama_service.ts', import.meta.url),
      'utf8'
    )
    assert.match(source, /axios\.get\(fullUrl, \{ timeout: 10_000 \}\)/)
    assert.doesNotMatch(source, /Invalid response format[\s\S]{0,100}JSON\.stringify/)
  })
})

describe('model capability cache', () => {
  it('memoizes successful true and false capability lookups by exact model name', () => {
    const cache = new ModelCapabilityCache()
    assert.equal(cache.get('qwen'), undefined)
    cache.recordSuccessfulLookup('qwen', true)
    cache.recordSuccessfulLookup('plain', false)
    assert.equal(cache.get('qwen'), true)
    assert.equal(cache.get('plain'), false)
    assert.equal(cache.get('QWEN'), undefined)
    cache.invalidate('qwen')
    assert.equal(cache.get('qwen'), undefined)
  })
})
