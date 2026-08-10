import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideScanAction } from '../../app/utils/kb_ingest_decision.js'

describe('sideloaded ZIM ingest policy', () => {
  it('creates a pending decision instead of auto-ingesting in Manual mode', () => {
    assert.deepEqual(decideScanAction(null, false, 'Manual'), { kind: 'create_pending' })
  })

  it('preserves legacy auto-ingest in Always mode', () => {
    assert.deepEqual(decideScanAction(null, false, 'Always'), {
      kind: 'dispatch',
      createStateRow: true,
    })
  })

  it('honors an existing browse-only decision', () => {
    assert.deepEqual(decideScanAction({ state: 'browse_only' }, false, 'Always'), { kind: 'skip' })
  })
})
