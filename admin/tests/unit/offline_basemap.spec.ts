import * as assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { inspectOfflineBasemap } from '../../app/utils/offline_basemap.js'
import { getOfflineBasemapNotice } from '../../inertia/lib/offline_basemap.js'

const validPmtiles = Buffer.alloc(127)
Buffer.from([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 0x03]).copy(validPmtiles)

test('detects available, missing, corrupt, and unavailable basemaps using disposable files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'watchman-basemap-'))
  const world = join(root, 'world.pmtiles')

  assert.equal(await inspectOfflineBasemap(root, world), 'missing')
  await writeFile(world, validPmtiles)
  assert.equal(await inspectOfflineBasemap(root, world), 'available')
  await writeFile(world, 'not pmtiles')
  assert.equal(await inspectOfflineBasemap(root, world), 'corrupt')
  assert.equal(await inspectOfflineBasemap(join(root, 'absent'), world), 'storage_unavailable')

  const directoryAtFilePath = join(root, 'directory.pmtiles')
  await mkdir(directoryAtFilePath)
  assert.equal(await inspectOfflineBasemap(root, directoryAtFilePath), 'corrupt')
})

test('uses Watchman wording, reports regional-only operation, and never includes paths', () => {
  const notice = getOfflineBasemapNotice({ status: 'missing', regionalMapsPresent: true })
  assert.equal(notice?.title, 'Offline basemap unavailable')
  assert.match(notice?.message ?? '', /regional map files may still be available/i)
  assert.doesNotMatch(notice?.message ?? '', /(?:\/storage|[A-Z]:\\|pmtiles\/)/)
  assert.equal(notice?.canDownload, true)
})

test('returns consistent non-download notices for corrupt, unreadable, storage, and service failures', () => {
  for (const status of [
    'corrupt',
    'unreadable',
    'storage_unavailable',
    'service_unavailable',
  ] as const) {
    const notice = getOfflineBasemapNotice({ status, regionalMapsPresent: false })
    assert.ok(notice)
    assert.equal(notice.canDownload, false)
  }
  assert.equal(getOfflineBasemapNotice({ status: 'available', regionalMapsPresent: false }), null)
})
