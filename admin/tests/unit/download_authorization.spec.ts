import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyPermanentDownloadError,
  PermanentDownloadAuthError,
} from '../../app/utils/downloads.js'

describe('permanent download authorization failures', () => {
  for (const status of [401, 403]) {
    it(`classifies HTTP ${status} as permanent`, () => {
      const result = classifyPermanentDownloadError({ response: { status } })
      assert.ok(result instanceof PermanentDownloadAuthError)
      assert.match(result.message, new RegExp(String(status)))
    })
  }

  it('keeps recoverable failures retryable', () => {
    assert.equal(classifyPermanentDownloadError({ response: { status: 500 } }), null)
    assert.equal(classifyPermanentDownloadError(new Error('socket reset')), null)
  })
})
