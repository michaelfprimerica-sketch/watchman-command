import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasDownloadJobPayload,
  normalizeDownloadPath,
} from '../../app/utils/download_job_records.js'

describe('download job record safety', () => {
  it('rejects orphaned BullMQ records', () => {
    assert.equal(hasDownloadJobPayload(undefined), false)
    assert.equal(hasDownloadJobPayload({ id: 'job-1', data: null }), false)
    assert.equal(hasDownloadJobPayload({ id: null, data: { filepath: '/tmp/file' } }), false)
    assert.equal(hasDownloadJobPayload({ id: 'job-1', data: {} }), true)
  })

  it('normalizes valid paths and tolerates missing paths', () => {
    assert.equal(normalizeDownloadPath('/tmp/a/../b'), '/tmp/b')
    assert.equal(normalizeDownloadPath(undefined), '')
    assert.equal(normalizeDownloadPath({}), '')
  })
})
