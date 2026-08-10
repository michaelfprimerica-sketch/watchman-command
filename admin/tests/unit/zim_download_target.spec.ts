import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveZimDownloadTarget } from '../../app/utils/zim_download_target.js'

describe('remote ZIM download target safety', () => {
  const storageRoot = '/opt/watchman/storage/zim'

  it('uses only the parsed URL pathname for a normal ZIM target', () => {
    assert.deepEqual(
      resolveZimDownloadTarget(
        'https://example.invalid/library/field-guide_2026-08.zim?token=value#section',
        storageRoot
      ),
      {
        filename: 'field-guide_2026-08.zim',
        filepath: '/opt/watchman/storage/zim/field-guide_2026-08.zim',
      }
    )
  })

  it('rejects encoded separators revealed during decoding', () => {
    assert.throws(
      () =>
        resolveZimDownloadTarget('https://example.invalid/library/..%2Foutside.zim', storageRoot),
      /Invalid ZIM filename/
    )
  })

  it('does not let query or fragment slashes select a dot-segment target', () => {
    for (const url of [
      'https://example.invalid/library/field-guide.zim?target=/..',
      'https://example.invalid/library/field-guide.zim#target=/..',
    ]) {
      const target = resolveZimDownloadTarget(url, storageRoot)
      assert.equal(target.filename, 'field-guide.zim')
      assert.equal(target.filepath, '/opt/watchman/storage/zim/field-guide.zim')
    }
  })

  it('rejects non-ZIM URL paths even when the query mentions a ZIM', () => {
    assert.throws(
      () =>
        resolveZimDownloadTarget('https://example.invalid/download?file=guide.zim', storageRoot),
      /URL path must end with \.zim/
    )
  })
})
